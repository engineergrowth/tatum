# Bitcoin Testnet Transaction Script

This Node.js script demonstrates how to build, sign, and broadcast a Bitcoin testnet transaction using the Tatum API for blockchain communication and the `bitcoinjs-lib` library for local, client-side signing.

---

## Prerequisites

Before you begin, ensure you have the following installed and configured:
* **Node.js** (v16 or later)
* **npm** (Node Package Manager)
* **A Tatum API Key** - You can get a free key from the [Tatum Dashboard](https://dashboard.tatum.io/).

---

## How to Run

Follow these steps in order to set up the environment and send a transaction.

**1. Initial Setup**
   * Install the required dependencies from your terminal:
     ```bash
     npm install dotenv axios bitcoinjs-lib ecpair tiny-secp256k1 bip39 bip32
     ```
   * Create a file named `.env` in the project directory and add your Tatum API key:
     ```
     TATUM_API_KEY="YOUR_API_KEY_HERE"
     ```

**2. Generate Your Wallet**
   * Run the script for the first time. It will connect to Tatum and generate a new wallet.
     ```bash
     node sendBTC.js
     ```

**3. Save Your Wallet Credentials**
   * The script's output will include a `WALLET_MNEMONIC` and a `WALLET_XPUB`.
   * Copy these two lines from your console and paste them into your `.env` file. This saves the wallet so you can reuse it.

**4. Fund the Wallet**
   * The console output also shows a "From Address" that starts with `tb1q...`. Copy this address.
   * Go to a testnet faucet and send funds to it.
   * **Working Faucet:** [https://coinfaucet.eu/en/btc-testnet/](https://coinfaucet.eu/en/btc-testnet/)

**5. Send the Transaction**
   * Wait a few minutes for the funding transaction to be confirmed on the blockchain.
   * **Run the script again.** This time, it will load your saved wallet, find the funds, and send the transaction.
     ```bash
     node sendBTC.js
     ```

---

## What to Expect

* **First Run:** The script will create a new wallet and instruct you to save the credentials to your `.env` file. It will then exit and ask you to fund the generated address.

* **Successful Run:** On subsequent runs, the script will load the saved wallet, detect the funds, and proceed with the transaction. The console will show the steps of the process, and the final output will be the broadcast response from Tatum, including the transaction ID and a link to a block explorer.

    **Example Console Output:**
    ```json
    {
      "txId": "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2"
    }
    ```