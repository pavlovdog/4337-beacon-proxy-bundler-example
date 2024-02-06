import { ethers } from "ethers";
import { Presets, Client } from "userop";

import "dotenv/config";
import AccountBuilder from "../src/account-builder";

const rpcUrl = process.env.RPC_URL || "";
const paymasterUrl = process.env.PAYMASTER_URL || "";

async function main() {
  const paymasterContext = {
    type: 'payg'
  };
  const paymasterMiddleware = Presets.Middleware.verifyingPaymaster(
    paymasterUrl,
    paymasterContext
  );
  const opts = paymasterUrl.toString() === "" ? {} : {
    paymasterMiddleware: paymasterMiddleware,
  }

  // Initialize the account
  const signer = ethers.Wallet.createRandom();

  console.log("Account owner address:", signer.address);

  const builder = await AccountBuilder.init(signer, rpcUrl, {
    ...opts,
    factory: '0x48B65829444A3bF831eeea5861e3BF7303685ebe',
    entryPoint: '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789'
  });
  const address = builder.getSender();
  console.log(`Account address: ${address}`);

  // Send the User Operation to the ERC-4337 mempool
  const client = await Client.init(rpcUrl);

  const res = await client.sendUserOperation(builder.approvePayMaster(), {
    onBuild: (op) => console.log("Signed UserOperation:", JSON.stringify(op)),
  });

  // Return receipt
  console.log(`UserOpHash: ${res.userOpHash}`);
  console.log("Waiting for transaction...");
  const ev = await res.wait();
  console.log(`Transaction hash: ${ev?.transactionHash ?? null}`);
  console.log(`View here: https://jiffyscan.xyz/userOpHash/${res.userOpHash}`);
}


main().catch((err) => console.error("Error:", err));