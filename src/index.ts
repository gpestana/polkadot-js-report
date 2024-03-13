// needed as of 7.x series, see CHANGELOG of the api repo.
import '@polkadot/api-augment';
import '@polkadot/types-augment';

import { ApiPromise, WsProvider } from '@polkadot/api';
import { ApiDecoration } from '@polkadot/api/types';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

const optionsPromise = yargs(hideBin(process.argv)).option('endpoint', {
	alias: 'e',
	type: 'string',
	default: 'wss://polkadot-rpc.dwellir.com',
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

	console.log(
		`****************** Connected to node: ${(await api.rpc.system.chain()).toHuman()} [ss58: ${
			api.registry.chainSS58
		}] ******************`
	);

	const controllers = await duplicate_controllers(apiAt);
	// iterate on set
	for (const controller of controllers) {
		await when_controller_deprecated(api, controller);
	}

	process.exit(0);
}

async function duplicate_controllers(apiAt: ApiDecoration<'promise'>) {
	const reverse_bonded = new Map(); // controller -> stash
	const duplicate_controllers = new Set<string>();

	(await apiAt.query.staking.bonded.entries()).map(([stash, controller]) => {
		if (reverse_bonded.has(controller.toHuman())) {
			console.log(
				'\x1b[36m%s\x1b[0m',
				`🙈 🙉 🙊 Duplicate controller found: ${controller.toHuman()} for stashes ${stash.toHuman()} and ${reverse_bonded.get(
					controller.toHuman()
				)}`
			);
			duplicate_controllers.add(controller.toString());
		} else {
			reverse_bonded.set(controller.toHuman(), stash.toHuman());
		}
	});

	return duplicate_controllers;
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
}

main().catch(console.error);
