require('dotenv').config();
const axios = require('axios');
const bitcoin = require('bitcoinjs-lib');
const ECPairFactory = require('ecpair').default;
const ecc = require('tiny-secp256k1');
const bip39 = require('bip39');
const BIP32Factory = require('bip32').default;

// Initialize ECPair and BIP32 with ECC library
const ECPair = ECPairFactory(ecc);
const bip32 = BIP32Factory(ecc);

// Tatum API credentials from environment
const TATUM_API_KEY = process.env.TATUM_API_KEY;
const TATUM_BASE_URL = 'https://api.tatum.io';

// Bitcoin testnet network
const NETWORK = bitcoin.networks.testnet;

/**
 * Step 1: Generates a Bitcoin testnet wallet with mnemonic and extended public key
 * This creates a new HD wallet that can derive multiple addresses
 */
async function generateWallet() {
  const response = await axios.get(`${TATUM_BASE_URL}/v3/bitcoin/wallet`, {
    headers: { 'x-api-key': TATUM_API_KEY }
  });
  return response.data;
}

/**
 * Step 1: Generates a private key from mnemonic and derivation index locally
 * Uses BIP39 and BIP32 to derive keys without ever sending mnemonic to an API
 *
 * @param {string} mnemonic - BIP39 mnemonic phrase
 * @param {number} index - Derivation index (default 0)
 * @returns {string} Private key in WIF format
 */
function generatePrivateKey(mnemonic, index = 0) {
  // Convert mnemonic to seed
  const seed = bip39.mnemonicToSeedSync(mnemonic);

  // Create HD node from seed
  const root = bip32.fromSeed(seed, NETWORK);

  // Derive key using BIP44 path for Bitcoin Testnet: m/44'/1'/0'/0/index
  // 44' = BIP44, 1' = Testnet, 0' = Account 0, 0 = External chain, index = Address index
  const path = `m/44'/1'/0'/0/${index}`;
  const child = root.derivePath(path);

  // Convert Uint8Array to Buffer for compatibility with ecpair
  const privateKeyBuffer = Buffer.from(child.privateKey);

  // Return private key in WIF format (required by bitcoinjs-lib)
  return ECPair.fromPrivateKey(privateKeyBuffer, { network: NETWORK }).toWIF();
}

/**
 * Step 1: Generates a Bitcoin address from extended public key and index
 * Derives a specific address from the HD wallet
 */
async function generateAddress(xpub, index = 0) {
  const response = await axios.get(`${TATUM_BASE_URL}/v3/bitcoin/address/${xpub}/${index}`, {
    headers: { 'x-api-key': TATUM_API_KEY }
  });
  return response.data.address;
}

/**
 * Step 2: Fetches UTXOs (Unspent Transaction Outputs) for a given address
 * These are the "coins" we can spend from this address
 *
 * @param {string} address - Bitcoin address to fetch UTXOs for
 * @param {number} totalValue - Optional total value in BTC to fetch (default: get all up to 10 BTC)
 */
async function getUTXOs(address, totalValue = 10) {
  const response = await axios.get(`${TATUM_BASE_URL}/v4/data/utxos`, {
    params: {
      chain: 'bitcoin-testnet',
      address: address,
      totalValue: totalValue  // Required by v4 API - gets UTXOs up to this BTC amount
    },
    headers: { 'x-api-key': TATUM_API_KEY }
  });
  return response.data;
}

/**
 * Step 2: Fetches the raw transaction hex for a given transaction hash
 * Required for PSBT to validate the input being spent
 */
async function getRawTransaction(txHash) {
  const response = await axios.get(`${TATUM_BASE_URL}/v3/bitcoin/transaction/${txHash}`, {
    headers: { 'x-api-key': TATUM_API_KEY }
  });
  return response.data.hex;
}

/**
 * Step 2: Builds and signs a Bitcoin transaction locally using bitcoinjs-lib PSBT
 * This constructs the transaction object with inputs (UTXOs) and outputs (recipients)
 * The transaction is signed with the private key locally, NOT sent to Tatum for signing
 *
 * @param {Array} utxos - Array of UTXOs to use as inputs
 * @param {string} toAddress - Recipient address
 * @param {number} amountSatoshis - Amount to send in satoshis
 * @param {string} privateKeyWIF - Private key in WIF format for signing
 * @param {string} changeAddress - Address to send change back to
 * @param {number} feeRate - Fee rate in satoshis per byte (default 10)
 * @returns {string} Raw transaction hex ready for broadcast
 */
async function buildAndSignTransaction(utxos, toAddress, amountSatoshis, privateKeyWIF, changeAddress, feeRate = 10) {
  console.log('\n=== Step 2: Building and Signing Transaction Locally ===');

  // Create key pair from WIF private key
  const keyPair = ECPair.fromWIF(privateKeyWIF, NETWORK);

  // Create PSBT (Partially Signed Bitcoin Transaction)
  const psbt = new bitcoin.Psbt({ network: NETWORK });

  // Calculate total input value and add inputs
  let totalInput = 0;
  console.log('Adding inputs from UTXOs:');

  for (const utxo of utxos) {
    // Convert BTC to satoshis (Tatum returns value as BTC string like "0.001")
    const valueSatoshis = Math.floor(parseFloat(utxo.value) * 100000000);

    // For SegWit addresses (tb1q...), use witnessUtxo for better compatibility
    // Fetch the raw transaction hex for validation
    const rawTxHex = await getRawTransaction(utxo.txHash);
    const tx = bitcoin.Transaction.fromHex(rawTxHex);
    const output = tx.outs[utxo.index];

    psbt.addInput({
      hash: utxo.txHash,
      index: utxo.index,
      witnessUtxo: {
        script: output.script,
        value: valueSatoshis
      },
      // Also include nonWitnessUtxo for full validation
      nonWitnessUtxo: Buffer.from(rawTxHex, 'hex')
    });

    totalInput += valueSatoshis;
    console.log(`  - UTXO ${utxo.txHash.substring(0, 16)}... (${valueSatoshis} sats)`);
  }

  console.log(`Total input: ${totalInput} satoshis`);

  // Estimate transaction size for fee calculation
  // Rough estimate: (inputs * 148) + (outputs * 34) + 10
  // Note: 10 sat/byte is a safe default for testnet. For mainnet, use fee estimation API.
  const estimatedSize = (utxos.length * 148) + (2 * 34) + 10;
  const fee = estimatedSize * feeRate;
  console.log(`Estimated fee: ${fee} satoshis (${estimatedSize} bytes * ${feeRate} sat/byte)`);

  // Calculate change
  const change = totalInput - amountSatoshis - fee;

  if (change < 0) {
    throw new Error(`Insufficient funds. Need ${amountSatoshis + fee} sats, have ${totalInput} sats`);
  }

  // Add output for recipient
  psbt.addOutput({
    address: toAddress,
    value: amountSatoshis
  });
  console.log(`Output to recipient: ${amountSatoshis} satoshis`);

  // Add change output if significant (more than dust threshold ~546 sats)
  if (change > 1000) {
    psbt.addOutput({
      address: changeAddress,
      value: change
    });
    console.log(`Change output: ${change} satoshis`);
  } else {
    console.log(`Change (${change} sats) added to fee (too small for separate output)`);
  }

  // Sign all inputs locally
  console.log('\nSigning transaction locally with private key...');
  for (let i = 0; i < utxos.length; i++) {
    psbt.signInput(i, keyPair, [bitcoin.Transaction.SIGHASH_ALL]);
  }

  // Validate signatures
  psbt.validateSignaturesOfAllInputs((pubkey, msghash, signature) => {
    return ECPair.fromPublicKey(pubkey, { network: NETWORK }).verify(msghash, signature);
  });

  // Finalize all inputs (adds witness/scriptSig data)
  psbt.finalizeAllInputs();

  // Extract the final transaction and get raw hex
  const transaction = psbt.extractTransaction();
  const rawHex = transaction.toHex();
  const txId = transaction.getId();

  console.log('Transaction built and signed locally');
  console.log('Transaction ID:', txId);
  console.log('Raw hex (first 100 chars):', rawHex.substring(0, 100) + '...');
  console.log('Transaction size:', rawHex.length / 2, 'bytes');

  return rawHex;
}

/**
 * Step 3: Broadcasts the signed transaction to the Bitcoin testnet
 * This submits the raw signed transaction hex to the network via POST /v3/bitcoin/broadcast
 *
 * @param {string} rawHex - The signed transaction in raw hexadecimal format
 * @returns {Object} Broadcast response with txId
 */
async function broadcastTransaction(rawHex) {
  console.log('\n=== Step 3: Broadcasting Transaction ===');

  const response = await axios.post(`${TATUM_BASE_URL}/v3/bitcoin/broadcast`, {
    txData: rawHex
  }, {
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': TATUM_API_KEY
    }
  });

  console.log('Transaction broadcast successfully!');
  return response.data;
}

/**
 * Main function that executes the complete Bitcoin transaction workflow
 * Following the spec requirements:
 * 1. Wallet & UTXO prep - Generate wallet, get addresses, fund from faucet, fetch UTXOs
 * 2. Transaction build & sign - Construct transaction and sign locally with bitcoinjs-lib
 * 3. Broadcast - Submit raw hex via POST /v3/bitcoin/broadcast
 */
async function main() {
  try {
    console.log('=== Bitcoin Testnet Transaction Demo ===\n');

    // Step 1: Generate or load wallet
    console.log('=== Step 1: Wallet & UTXO Prep ===');

    // Check if we have a saved wallet in .env, otherwise generate new one
    let wallet;
    if (process.env.WALLET_MNEMONIC && process.env.WALLET_XPUB) {
      console.log('Loading saved wallet from .env');
      wallet = {
        mnemonic: process.env.WALLET_MNEMONIC,
        xpub: process.env.WALLET_XPUB
      };
    } else {
      console.log('Generating new wallet...');
      wallet = await generateWallet();
      console.log('\nSAVE THESE LINES TO YOUR .env FILE (copy/paste):');
      console.log('─────────────────────────────────────────────────────────');
      console.log(`WALLET_MNEMONIC="${wallet.mnemonic}"`);
      console.log(`WALLET_XPUB="${wallet.xpub}"`);
      console.log('─────────────────────────────────────────────────────────\n');
    }

    const fromAddress = await generateAddress(wallet.xpub, 0);
    const toAddress = await generateAddress(wallet.xpub, 1);
    const privateKey = generatePrivateKey(wallet.mnemonic, 0);

    console.log('From Address:', fromAddress);
    console.log('To Address:', toAddress);

    // Fetch UTXOs for the address
    console.log('\nFetching UTXOs...');
    const utxosResponse = await getUTXOs(fromAddress);

    // Debug: Show what we got back from the API
    console.log('UTXO Response:', JSON.stringify(utxosResponse, null, 2));

    // Handle different response formats (v4 API might return object with 'data' property)
    const utxos = Array.isArray(utxosResponse) ? utxosResponse : utxosResponse.data || utxosResponse;

    if (!utxos || utxos.length === 0) {
      console.log('\nAddress not funded. Please fund using testnet faucet:');
      console.log('   https://coinfaucet.eu/en/btc-testnet');
      console.log('   Address to fund:', fromAddress);
      console.log('\nAfter funding, run this script again to complete the transaction.');
      return;
    }

    console.log(`Found ${utxos.length} UTXO(s)`);
    const totalBalance = utxos.reduce((sum, utxo) => sum + parseFloat(utxo.value), 0);
    console.log('Total balance:', totalBalance, 'BTC');

    // Step 2: Build and sign transaction locally using bitcoinjs-lib
    const amountToSend = 1000; // Amount in satoshis (0.00001 BTC = 1000 sats)
    console.log(`\nPreparing to send ${amountToSend} satoshis (${amountToSend / 100000000} BTC)`);
    console.log(`From: ${fromAddress}`);
    console.log(`To: ${toAddress}`);

    const rawHex = await buildAndSignTransaction(
      utxos,
      toAddress,
      amountToSend,
      privateKey,
      fromAddress
    );

    // Step 3: Broadcast the signed transaction
    const result = await broadcastTransaction(rawHex);

    console.log('\n=== Transaction Complete ===');
    console.log('Broadcast Response:', JSON.stringify(result, null, 2));
    console.log('\nView on explorer:');
    console.log(`https://blockstream.info/testnet/tx/${result.txId}`);

  } catch (error) {
    console.error('\nError:', error.response?.data || error.message);
    if (error.response?.data) {
      console.error('Details:', JSON.stringify(error.response.data, null, 2));
    }
    if (error.stack && !error.response) {
      console.error('Stack:', error.stack);
    }
  }
}

// Run the script
if (require.main === module) {
  main();
}

module.exports = {
  generateWallet,
  generatePrivateKey,
  generateAddress,
  getUTXOs,
  getRawTransaction,
  buildAndSignTransaction,
  broadcastTransaction
};
