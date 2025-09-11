import { CoreEvalProposal } from "@agoric/cosmic-proto/swingset/swingset.js";
import { MsgInstallBundle } from "@agoric/cosmic-proto/swingset/msgs.js";
import { StdFee } from "@cosmjs/amino";
import { fromBech32 } from "@cosmjs/encoding";
import { coins, Registry } from "@cosmjs/proto-signing";
import { defaultRegistryTypes } from "@cosmjs/stargate";
import { TextProposal } from "cosmjs-types/cosmos/gov/v1beta1/gov";
import { ParameterChangeProposal } from "cosmjs-types/cosmos/params/v1beta1/params";
import { Any } from "cosmjs-types/google/protobuf/any";
import type { ParamChange } from "cosmjs-types/cosmos/params/v1beta1/params";
import { CommunityPoolSpendProposal } from "cosmjs-types/cosmos/distribution/v1beta1/distribution";
import { Params as CosmjsGovV1Params } from "cosmjs-types/cosmos/gov/v1/gov";
import { MsgUpdateParams as MsgUpdateGovParamsV1, MsgSubmitProposal } from "cosmjs-types/cosmos/gov/v1/tx";
import Long from "long";

export const registry = new Registry([
  ...defaultRegistryTypes,
  ["/agoric.swingset.MsgInstallBundle", MsgInstallBundle],
]);

export const makeCommunityPoolSpendProposalMsg = ({
  proposer,
  recipient,
  amount,
  title,
  description,
  deposit,
}: {
  proposer: string;
  recipient: string;
  amount: string;
  title: string;
  description: string;
  deposit?: number | string;
}) => {
  const communityPoolSpendProposal: CommunityPoolSpendProposal = {
    title,
    description,
    recipient,
    amount: coins(amount, "ubld"),
  };
  const msgSubmitProposal = {
    typeUrl: "/cosmos.gov.v1beta1.MsgSubmitProposal",
    value: {
      content: {
        typeUrl: "/cosmos.distribution.v1beta1.CommunityPoolSpendProposal",
        value: CommunityPoolSpendProposal.encode(
          communityPoolSpendProposal,
        ).finish(),
      },
      proposer: proposer,
      ...(deposit &&
        Number(deposit) && { initialDeposit: coins(deposit, "ubld") }),
    },
  };
  return msgSubmitProposal;
};

interface MakeTextProposalArgs {
  title: string;
  description: string;
  proposer: string;
  deposit?: string | number;
}

export const makeTextProposalMsg = ({
  title,
  description,
  proposer,
  deposit,
}: MakeTextProposalArgs) => ({
  typeUrl: "/cosmos.gov.v1beta1.MsgSubmitProposal",
  value: {
    content: Any.fromPartial({
      typeUrl: "/cosmos.gov.v1beta1.TextProposal",
      value: Uint8Array.from(
        TextProposal.encode(
          TextProposal.fromPartial({
            title,
            description,
          }),
        ).finish(),
      ),
    }),
    proposer,
    ...(deposit &&
      Number(deposit) && { initialDeposit: coins(deposit, "ubld") }),
  },
});

export const makeCoreEvalProposalMsg = ({
  title,
  description,
  evals,
  proposer,
  deposit,
}: CoreEvalProposal & { proposer: string; deposit?: string | number }) => ({
  typeUrl: "/cosmos.gov.v1beta1.MsgSubmitProposal",
  value: {
    content: Any.fromPartial({
      typeUrl: "/agoric.swingset.CoreEvalProposal",
      value: Uint8Array.from(
        CoreEvalProposal.encode(
          CoreEvalProposal.fromPartial({
            title,
            description,
            evals,
          }),
        ).finish(),
      ),
    }),
    proposer,
    ...(deposit &&
      Number(deposit) && { initialDeposit: coins(deposit, "ubld") }),
  },
});

export interface ParamChangeArgs {
  title: string;
  description: string;
  changes: ParamChange[];
  proposer: string;
  deposit?: number | string;
}

export const makeParamChangeProposalMsg = ({
  title,
  description,
  changes,
  proposer,
  deposit = 1000000,
}: ParamChangeArgs) => ({
  typeUrl: "/cosmos.gov.v1beta1.MsgSubmitProposal",
  value: {
    content: Any.fromPartial({
      typeUrl: "/cosmos.params.v1beta1.ParameterChangeProposal",
      value: Uint8Array.from(
        ParameterChangeProposal.encode(
          ParameterChangeProposal.fromPartial({
            title,
            description,
            changes,
          }),
        ).finish(),
      ),
    }),
    proposer,
    ...(deposit &&
      Number(deposit) && { initialDeposit: coins(deposit, "ubld") }),
  },
});

export interface MsgInstallArgs {
  compressedBundle: Uint8Array;
  uncompressedSize: string;
  submitter: string;
}

export const makeInstallBundleMsg = ({
  compressedBundle,
  uncompressedSize,
  submitter,
}: MsgInstallArgs) => ({
  typeUrl: "/agoric.swingset.MsgInstallBundle",
  value: {
    compressedBundle,
    uncompressedSize,
    submitter: fromBech32(submitter).data,
  },
});

interface MakeFeeObjectArgs {
  denom?: string;
  amount?: string | number;
  gas?: string | number;
}

export const makeFeeObject = ({ denom, amount, gas }: MakeFeeObjectArgs) =>
  ({
    amount: coins(amount || 0, denom || "uist"),
    gas: gas ? String(gas) : "auto",
  }) as StdFee;


  
export const makeGovV1ProposalMsg = ({
  messages,
  initialDeposit,
  proposer,
  metadata,
  title,
  summary,
}: MsgSubmitProposal) => ({
  typeUrl: "/cosmos.gov.v1.MsgSubmitProposal",
  value: MsgSubmitProposal.fromPartial({
    messages,
    initialDeposit,
    proposer,
    metadata,
    title,
    summary,
  }),
});

// Helper to convert seconds string to Duration with Long
const secondsToDuration = (seconds: string) => ({
  seconds: Long.fromString(seconds),
  nanos: 0,
});

// Create MsgUpdateParams for Gov v1 parameter changes with proper Duration conversion
export const makeMsgUpdateGovParams = ({
  authority,
  formData,
}: {
  authority: string;
  formData: import("../types/gov").GovV1ParamFormData;
}) => {
  // Use basic cosmjs-types parameters that are definitely supported
  const params: CosmjsGovV1Params = {
    minDeposit: formData.minDeposit,
    maxDepositPeriod: secondsToDuration(formData.maxDepositPeriod),
    votingPeriod: secondsToDuration(formData.votingPeriod),
    quorum: formData.quorum,
    threshold: formData.threshold,
    vetoThreshold: formData.vetoThreshold,
    minInitialDepositRatio: formData.minInitialDepositRatio,
    burnVoteQuorum: formData.burnVoteQuorum,
    burnProposalDepositPrevote: formData.burnProposalDepositPrevote,
    burnVoteVeto: formData.burnVoteVeto,
  };

  return MsgUpdateGovParamsV1.fromPartial({
    authority,
    params,
  });
};

// Encode MsgUpdateParams as Any for inclusion in MsgSubmitProposal
export const createGovV1UpdateParamsAny = (msgUpdateParams: MsgUpdateGovParamsV1): Any => ({
  typeUrl: "/cosmos.gov.v1.MsgUpdateParams",
  value: MsgUpdateGovParamsV1.encode(msgUpdateParams).finish(),
});