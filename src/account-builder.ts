import {
  UserOperationBuilder,
  IPresetBuilderOpts,
  BundlerJsonRpcProvider,
  UserOperationMiddlewareFn,
} from 'userop';

import { ethers } from 'ethers';
import {
  EntryPoint,
  EntryPoint__factory,
  AccountFactory,
  AccountFactory__factory,
  Account as AccountImpl,
  Account__factory,
} from "./typechain";

import {
  estimateUserOperationGas,
  getGasPrice,
  signUserOpHash
} from 'userop/dist/preset/middleware';


export default class AccountBuilder extends UserOperationBuilder {
  private signer: ethers.Signer;
  private provider: ethers.providers.JsonRpcProvider;
  private entryPoint: EntryPoint;
  private accountFactory: AccountFactory;
  private initCode: string;
  private nonceKey: number;
  proxy: AccountImpl;

  private constructor(
    signer: ethers.Signer,
    rpcUrl: string,
    opts: IPresetBuilderOpts
  ) {
    super();
    this.signer = signer;
    this.provider = new BundlerJsonRpcProvider(rpcUrl).setBundlerRpc(opts.overrideBundlerRpc);
    this.entryPoint = EntryPoint__factory.connect(opts.entryPoint || "", this.provider);
    this.accountFactory = AccountFactory__factory.connect(opts.factory || "", this.provider);

    this.initCode = "0x";
    this.nonceKey = opts?.nonceKey || 0;
    this.proxy = Account__factory.connect(
      ethers.constants.AddressZero,
      this.provider
    );
  }

  private resolveAccount: UserOperationMiddlewareFn = async (ctx) => {
    const [nonce, code] = await Promise.all([
      this.entryPoint.getNonce(ctx.op.sender, this.nonceKey),
      this.provider.getCode(ctx.op.sender),
    ]);
    ctx.op.nonce = nonce;
    ctx.op.initCode = code === "0x" ? this.initCode : "0x";
  };

  public static async init(
    signer: ethers.Signer,
    rpcUrl: string,
    opts: IPresetBuilderOpts
  ): Promise<AccountBuilder> {
    const instance = new AccountBuilder(signer, rpcUrl, opts);

    try {
      instance.initCode = await ethers.utils.hexConcat([
        instance.accountFactory.address,
        instance.accountFactory.interface.encodeFunctionData("deployAccount", [await signer.getAddress()]),
      ]);
      await instance.entryPoint.callStatic.getSenderAddress(instance.initCode);

      throw new Error("getSenderAddress: unexpected result");
    } catch (error: any) {
      const addr = error?.errorArgs?.sender;
      if (!addr) throw error;

      instance.proxy = Account__factory.connect(addr, instance.provider);
    }

    const base = instance
      .useDefaults({
        sender: instance.proxy.address,
        signature: await instance.signer.signMessage(
          ethers.utils.arrayify(ethers.utils.keccak256("0xdead"))
        ),
      })
      .useMiddleware(instance.resolveAccount)
      .useMiddleware(getGasPrice(instance.provider));

    const withPM = opts?.paymasterMiddleware
      ? base.useMiddleware(opts.paymasterMiddleware)
      : base.useMiddleware(estimateUserOperationGas(instance.provider));

    return withPM.useMiddleware(signUserOpHash(instance.signer));
  }

  approvePayMaster() {
    const abi = [
      "function approve(address _spender, uint256 _value) external returns (bool)"
    ];

    const interface_ = new ethers.utils.Interface(abi);

    const approveData = interface_.encodeFunctionData("approve", [
      "0xE93ECa6595fe94091DC1af46aaC2A8b5D7990770",
      "100000"
    ]);

    return this.setCallData(
      this.proxy.interface.encodeFunctionData("execute", [
        "0x3870419Ba2BBf0127060bCB37f69A1b1C090992B",
        0,
        approveData,
      ])
    );
  }
}