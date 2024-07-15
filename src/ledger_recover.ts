// needed as of 7.x series, see CHANGELOG of the api repo.
import '@polkadot/api-augment';
import '@polkadot/types-augment';
import '@polkadot/types';

import { ApiPromise, WsProvider } from '@polkadot/api';
import { ApiDecoration } from '@polkadot/api/types';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
//import { U8aFixed } from `@polkadot/types`;

const STAKING_ID = 'staking ';

const optionsPromise = yargs(hideBin(process.argv)).option('endpoint', {
	alias: 'e',
	type: 'string',
	//default: 'wss://rpc.ibp.network/polkadot',
	default: 'wss://localhost:8000',
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
}
