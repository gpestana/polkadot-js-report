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
	//default: 'wss://polkadot-rpc.dwellir.com',
	//default: 'wss://polkadot-try-runtime-node.parity-chains.parity.io',
  default: 'wss://rpc.ibp.network/polkadot',
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
		`****************** Connected to node: ${chain} [ss58: ${
			api.registry.chainSS58
		}] ******************\n\n\n`
	);

  console.log(`> Starting report of corrupted ledgers\n - ${chain}\n - block ${latest_hash}\n - at ${new Date()}\n`);

  // check count of Ledgers and metadata.
  let summary = false;
  if (summary) {
    let ledger_keys = await api.query.staking.ledger.keys();
    let bonded_keys = await api.query.staking.bonded.keys();
    let payee_keys = await api.query.staking.payee.keys();
    console.log(`🔬 #ledgers: ${ledger_keys.length}, #bonded: ${bonded_keys.length}, #payee: ${payee_keys.length}\n`);
  }

  // check corrupt ledgers.
  let corrupt = true;
  if (corrupt) {
	  const [corrupt_controllers, none_ledgers] = await corrupt_ledgers(apiAt);
	  // iterate on set
	  for (const controller of corrupt_controllers) {
		  await when_controller_deprecated(api, controller);
	  }

    console.log(`⚫ None ledgers, i.e. 'Ledger(bonded_controller) = None'`);
    let n = 0;
    none_ledgers.forEach(c => {
      console.log(` ${c}`);
      n += 1;
    });
    console.log(`# of none ledgers: ${n}`);
  }

	process.exit(0);
}

async function corrupt_ledgers(apiAt: ApiDecoration<'promise'>) {
	const validators = await get_all_validators(apiAt);
	const reverse_bonded = new Map(); // controller -> stash
	const duplicate_controllers = new Set<string>();
  const none_ledgers: string[] = [];

  let bonded_entries = await apiAt.query.staking.bonded.entries();

	bonded_entries.map(([stash, controller]) => {
		if (reverse_bonded.has(controller.toHuman())) {
			const stash_two = reverse_bonded.get(controller.toHuman());
			console.log(
				'\x1b[36m%s\x1b[0m',
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

			duplicate_controllers.add(controller.toString());
		} else {
			reverse_bonded.set(controller.toHuman(), stash.toHuman());
		}
  });

  let bonded_controllers = (await apiAt.query.staking.bonded.entries()).map(([_s, c]) => c.toHuman());
  let ledgers_controllers = (await apiAt.query.staking.ledger.entries()).map(([c, _l]) => c.toHuman()?.toString());

    bonded_controllers.forEach(c => {
      let acc = c?.toString();
      if (acc !== undefined && !ledgers_controllers.includes(acc)) {
        none_ledgers.push(acc)
      }
    });

	return [duplicate_controllers, none_ledgers];
}

async function get_all_validators(apiAt: ApiDecoration<'promise'>) {
	return (await apiAt.query.staking.validators.keys()).map((key) => key.toHuman()?.toString());
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
