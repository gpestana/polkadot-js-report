// needed as of 7.x series, see CHANGELOG of the api repo.
import '@polkadot/api-augment';
import '@polkadot/types-augment';
import '@polkadot/types';

import { ApiPromise, WsProvider } from '@polkadot/api';
import { ApiDecoration } from '@polkadot/api/types';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

const STAKING_ID = 'staking ';

const optionsPromise = yargs(hideBin(process.argv)).option('endpoint', {
	alias: 'e',
	type: 'string',
	default: 'wss://polkadot-rpc.dwellir.com',
	//default: 'wss://kusama-rpc.dwellir.com',
	//default: 'ws://127.0.0.1:8000',
	description: 'the wss endpoint. It must allow unsafe RPCs.',
	required: true
}).argv;

async function main() {
	const options = await optionsPromise;
	const provider = new WsProvider(options.endpoint);
	const api = await ApiPromise.create({ provider });
	const latest = await api.derive.chain.bestNumber();
	const latest_hash = await api.rpc.chain.getBlockHash(latest);
	const apiAt = await api.at(latest_hash);

	const chain = (await api.rpc.system.chain()).toHuman();

	console.log(
		`****************** Connected to node: ${chain} [ss58: ${api.registry.chainSS58}] ******************\n\n\n`
	);

	console.log(
		`> Starting report of corrupted ledgers\n - ${chain}\n - block ${latest_hash}\n - at ${new Date()}\n`
	);

	// check count of Ledgers and metadata.
	const summary = true;
	if (summary) {
		const ledger_keys = await api.query.staking.ledger.keys();
		const bonded_keys = await api.query.staking.bonded.keys();
		const payee_keys = await api.query.staking.payee.keys();
		console.log(
			`🔬 #ledgers: ${ledger_keys.length}, #bonded: ${bonded_keys.length}, #payee: ${payee_keys.length}\n`
		);
	}

	// check corrupt ledgers.
	const corrupt = true;
	const check_locks = true;

	if (corrupt) {
		const when_deprecated = [];
		const when_none = [];

		const [corrupt_controllers, none_ledgers] = await corrupt_ledgers(apiAt, check_locks);
		// iterate on set of corrupted ledgers

		const do_deprecated = false;
		if (do_deprecated) {
			for (const controller of corrupt_controllers) {
				const when = await when_controller_deprecated(api, controller);
				when_deprecated.push([controller, when]);
			}
		}

		console.log(`\n⚫ None ledgers, i.e. 'Ledger(bonded_controller) = None'`);
		let n = 0;
		none_ledgers.forEach((c) => {
			console.log(` ${c}`);
			n += 1;
		});
		console.log(`# of none ledgers: ${n}`);
	}

	process.exit(0);
}

type BondedTriplet = [string, string, string];

async function corrupt_ledgers(apiAt: ApiDecoration<'promise'>, check_locks: boolean) {
	const validators = await get_all_validators(apiAt);
	const reverse_bonded = new Map(); // controller -> stash
	const duplicate_controllers = new Set<string>();
	const corrupted: BondedTriplet[] = [];
	const none_ledgers: string[] = [];

	const bonded_entries = await apiAt.query.staking.bonded.entries();

	bonded_entries.map(async ([stash, controller]) => {
		if (reverse_bonded.has(controller.toHuman())) {
			const stash_two = reverse_bonded.get(controller.toHuman());
			console.log(
				'\n\x1b[36m%s\x1b[0m',
				`🙈 🙉 🙊 Duplicate controller found: ${controller.toHuman()} | stash 1: ${stash.toHuman()} | stash 2: ${stash_two}`
			);

			console.log(
				'\x1b[31m%s\x1b[0m',
				`⚙️  ⚙️  ⚙️  is_validator controller: ${validators.includes(
					controller.toHuman()?.toString()
				)} | stash1 ${validators.includes(
					stash.toHuman()?.toString()
				)} | stash 2: ${validators.includes(stash_two.toString())}`
			);

			// add corrupted triplet to check the ledger's status later on.
			const controller_s = controller.toString();
			const stash_one_s = stash.toString();
			const stash_two_s = stash_two.toString();

			if (controller_s != undefined && stash_one_s != undefined && stash_two_s != undefined) {
				corrupted.push([controller_s, stash_one_s, stash_two_s]);
			}

			await stash_status(apiAt, controller_s, stash_one_s);
			await stash_status(apiAt, controller_s, stash_two_s);

			if (check_locks == true) {
				// check the status of the locks in the ledger associated with the controller/stash pair.
				await check_async_locks(apiAt, controller_s, stash_one_s);
			}

			duplicate_controllers.add(controller.toString());
		} else {
			reverse_bonded.set(controller.toHuman(), stash.toHuman());
		}
	});

	const bonded_controllers = (await apiAt.query.staking.bonded.entries()).map(([s, c]) => [
		s.toHuman()?.toString(),
		c.toHuman()?.toString()
	]);
	const ledgers_controllers = (await apiAt.query.staking.ledger.entries()).map(([c, _l]) =>
		c.toHuman()?.toString()
	);

	bonded_controllers.forEach(async ([s, c]) => {
		const controller = c?.toString();
		const stash = s?.toString();

		if (controller !== undefined && !ledgers_controllers.includes(controller)) {
			none_ledgers.push(controller);
			if (stash != undefined) {
				// check stash status.
				await stash_status(apiAt, controller, stash);
			} else {
				console.log('❌❌❌❌ should never happen -- check code.');
			}
		}
	});

	return [duplicate_controllers, none_ledgers];
}

async function get_all_validators(apiAt: ApiDecoration<'promise'>) {
	return (await apiAt.query.staking.validators.keys()).map((key) => key.toHuman()?.toString());
}

/// prints the corrupted ledger status to recover by stash.
async function stash_status(apiAt: ApiDecoration<'promise'>, c: string, s: string) {
	const controller = apiAt.registry.createType('AccountId', c);
	const stash = apiAt.registry.createType('AccountId', s);

	const lock_amount = await staking_lock(apiAt, s);
	const ledger = await apiAt.query.staking.ledger(controller);

	if (ledger.isNone) {
		console.log(
			`🎯 🎯 🎯 status for recovery for [controller: ${controller}, stash: ${stash}]: ledger: None, lock: ${lock_amount}`
		);
		return [0, 0];
	} else {
		const l = ledger.unwrap();
		console.log(
			`\n🎯 🎯 🎯 status for recovery for [controller: ${controller}, stash: ${stash}]: ledger.stash: ${l.stash}, ledger.total: ${l.total}, lock: ${lock_amount}`
		);
		return [l.total, lock_amount];
	}
}

// prints if staking stash locks are not in sync with ledger total.
async function check_async_locks(apiAt: ApiDecoration<'promise'>, c: string, s: string) {
	const controller = apiAt.registry.createType('AccountId', c);
	const stash = apiAt.registry.createType('AccountId', s);

	const lock_amount = await staking_lock(apiAt, s);
	const ledger = await apiAt.query.staking.ledger(controller);

	if (ledger.isNone) {
		// do nothing, alert raised elsewhere.
	} else {
		const l = ledger.unwrap();

		if (l.total.unwrap() !== lock_amount) {
			console.log(
				`‼️  stash.lock != ledger total for [controller: ${controller}, stash: ${stash}]: ledger.stash: ${l.stash}, ledger.total: ${l.total}, lock: ${lock_amount}`
			);
		} else {
			console.log(
				`✅ stash.lock == ledger total for [controller: ${controller}, stash: ${stash}]: ledger.stash: ${l.stash}, ledger.total: ${l.total}, lock: ${lock_amount}`
			);
		}
	}
}

async function staking_lock(apiAt: ApiDecoration<'promise'>, acc: string) {
	const stash = apiAt.registry.createType('AccountId', acc);
	const lock_amount = (await apiAt.query.balances.locks(stash)).map((l) => {
		const id = l.id.toHuman()?.toString();
		if (id == STAKING_ID) {
			return l.amount;
		}
	});

	if (lock_amount[0] == undefined) {
		return 0;
	} else {
		return lock_amount[0];
	}
}

/// checks when controller and stash became same.
async function when_controller_deprecated(api: ApiPromise, bonded_account: string) {
	const latest = await api.derive.chain.bestNumber();
	const latest_hash = await api.rpc.chain.getBlockHash(latest);
	const apiAt = await api.at(latest_hash);

	const acct = apiAt.registry.createType('AccountId', bonded_account);
	const latest_val = await apiAt.query.staking.bonded(acct);

	if (latest_val.isNone || latest_val.unwrap().toHuman() != acct.toHuman()) {
		console.log(`❌ ❌ ❌: Controller ${bonded_account} not deprecated yet.`);
		return;
	}

	// console.log(`Binary searching change in bonded value for: ${bonded_account}`);
	// console.log(`Current value: ${latest_val.toHuman()}`);

	let start = 0;
	let end = latest.toNumber();

	while (start <= end) {
		const mid = Math.floor((start + end) / 2);
		// console.log(`Searching between ${start} and ${end} with mid: ${mid}`);

		const blockHash = await api.rpc.chain.getBlockHash(mid);
		const apiAt = await api.at(blockHash);
		const bonded = await apiAt.query.staking.bonded(acct);
		// console.log(`bonded exists: ${bonded.isSome} at block: ${mid}`);

		if (bonded.toHuman() == latest_val.toHuman()) {
			end = mid - 1;
		} else {
			start = mid + 1;
		}
	}

	console.log(
		'\x1b[36m%s\x1b[0m',
		`🎭 🆘 ⚠️  🚧 Ledger overwritten for Controller ${bonded_account} at block: ${start} with hash: ${await api.rpc.chain.getBlockHash(
			start
		)}`
	);

	return start;
}

main().catch(console.error);
