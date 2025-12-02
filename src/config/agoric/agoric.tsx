import { useMemo, useRef, useState } from "react";
import { toast } from "react-toastify";
import { toHex } from "@cosmjs/encoding";
// TODO move into src/lib/something.ts
import { MsgInstallBundleResponse } from "@agoric/cosmic-proto/swingset/msgs.js";
import { ChunkInfo } from "@agoric/cosmic-proto/swingset/swingset.js";
import { Code } from "../../components/inline";
import { BundleForm, BundleFormArgs } from "../../components/BundleForm";
import { ProposalForm, ProposalArgs } from "../../components/ProposalForm";
import { Tabs } from "../../components/Tabs";
import { useNetwork } from "../../hooks/useNetwork";
import { useWallet } from "../../hooks/useWallet";
import { gzip } from "../../lib/compression";
import {
  makeCoreEvalProposalMsg,
  makeTextProposalMsg,
  makeInstallBundleMsg,
  makeSendChunkMsg,
  makeParamChangeProposalMsg,
  makeCommunityPoolSpendProposalMsg,
} from "../../lib/messageBuilder";
import { makeSignAndBroadcast } from "../../lib/signAndBroadcast";
import { useWatchBundle } from "../../hooks/useWatchBundle";
import { coinIsGTE, renderCoins } from "../../utils/coin.ts";
import { useQueries, useQuery, UseQueryResult } from "@tanstack/react-query";

import {
  accountBalancesQuery,
  depositParamsQuery,
  votingParamsQuery,
  swingSetParamsQuery,
} from "../../lib/queries.ts";
import { selectCoinBalance } from "../../lib/selectors.ts";
import { DepositParams, VotingParams } from "../../types/gov.ts";

const textEncoder = new TextEncoder();

const locale = "en";

const { format: formatBytesQuantity } = new Intl.NumberFormat(locale, {
  notation: "compact",
  style: "unit",
  unit: "byte",
});
const { format: formatPercent } = new Intl.NumberFormat(locale, {
  style: "percent",
  // @ts-expect-error Until the web platform types catch up.
  maximimumFractionDigits: 0,
});
const pluralRules = new Intl.PluralRules(locale);
const pluralizeEn = (count: number, singular: string, plural: string) => {
  const category = pluralRules.select(count);
  return category === "one" ? `${count} ${singular}` : `${count} ${plural}`;
};

const getSha512Hex = async (bytes: Uint8Array) => {
  const sha512Bytes = await crypto.subtle.digest("sha-512", bytes);
  return toHex(new Uint8Array(sha512Bytes));
};

const chunkBundle = async (bytes: Uint8Array, chunkSizeLimit: number) => {
  const bundleSha512Hex = await getSha512Hex(bytes);

  // Generate parallel arrays of the chunks and the chunk infos.
  const chunks: Uint8Array[] = [];
  const info: ChunkInfo[] = [];
  for (let i = 0; i < bytes.byteLength; i += chunkSizeLimit) {
    const chunk = bytes.subarray(
      i,
      Math.min(bytes.byteLength, i + chunkSizeLimit),
    );
    const chunkSha512Hex = await getSha512Hex(chunk);
    chunks.push(chunk);
    info.push({
      sha512: chunkSha512Hex,
      sizeBytes: BigInt(chunk.byteLength),
      state: 0,
    });
  }

  return {
    chunks,
    manifest: {
      sha512: bundleSha512Hex,
      sizeBytes: BigInt(bytes.byteLength),
      chunks: info,
    },
  };
};

const Agoric = () => {
  const { netName, networkConfig } = useNetwork();
  const { api } = useNetwork();
  const { walletAddress, stargateClient } = useWallet();
  const proposalFormRef = useRef<HTMLFormElement>(null);
  const corEvalFormRef = useRef<HTMLFormElement>(null);
  const bundleFormRef = useRef<HTMLFormElement>(null);
  const watchBundle = useWatchBundle(networkConfig?.rpc, {
    clipboard: window.navigator.clipboard,
  });

  const swingSetParams = useQuery(swingSetParamsQuery(api));
  const chunkSizeLimit = (({ isLoading, data }) => {
    if (isLoading || !data) {
      return Infinity;
    }
    const { chunk_size_limit_bytes = "" } = data;
    if (chunk_size_limit_bytes === "") {
      return Infinity;
    }
    return Number(chunk_size_limit_bytes);
  })(swingSetParams ?? { isLoading: false });

  const accountBalances = useQuery(accountBalancesQuery(api, walletAddress));
  const { minDeposit } = useQueries({
    queries: [depositParamsQuery(api), votingParamsQuery(api)],
    combine: (
      results: [
        UseQueryResult<DepositParams, unknown>,
        UseQueryResult<VotingParams, unknown>,
      ],
    ) => {
      const [deposit, voting] = results;
      return {
        minDeposit: deposit.data?.min_deposit,
        votingPeriod: voting.data?.voting_period,
      };
    },
  });

  const signAndBroadcast = useMemo(
    () => makeSignAndBroadcast(stargateClient, walletAddress, netName),
    [stargateClient, walletAddress, netName],
  );

  const validateBundle = (bundleString: string) => {
    let bundleObject;
    try {
      bundleObject = JSON.parse(bundleString);
    } catch (error) {
      throw new Error(
        // @ts-expect-error parse errors are in fact always Errors.
        `The submitted file is not in the expected format, not parsable as JSON: ${error.message}`,
      );
    }
    const { moduleFormat, endoZipBase64, endoZipBase64Sha512 } = bundleObject;
    if (moduleFormat !== "endoZipBase64") {
      throw new Error(
        `The submitted file does not have the expected moduleFormat value of endoZipBase64, got: ${moduleFormat}`,
      );
    }
    if (typeof endoZipBase64 !== "string") {
      throw new Error(
        `The submitted file does not have the expected endoZipBase64 property`,
      );
    }
    if (typeof endoZipBase64Sha512 !== "string") {
      throw new Error(
        `The submitted file does not have the expected endoZipBase64Sha512 property`,
      );
    }
    // Could go on to verify many other details, down to running checkBundle
    // locally, but our duty here is to catch silly errors like submitting
    // package.json.
    // Once submitted, the chain will perform a full verification down to every
    // leaf of the schema as well as integrity checks for all files by their
    // alleged SHA-512.
    return bundleObject;
  };

  async function handleBundle(args: BundleFormArgs) {
    await null;
    try {
      return await fallibleHandleBundle(args);
    } catch (unknownError) {
      const error = unknownError as Error & { autoCloseToast?: number };
      toast.error(error.message, { autoClose: error.autoCloseToast });
    }
  }

  async function fallibleHandleBundle(args: BundleFormArgs) {
    // Must be captured here to narrow optionality of walletAddress.
    if (!walletAddress) {
      throw Object.assign(new Error("wallet not connected"), {
        autoCloseToast: 3000,
      });
    }

    const bundleString: string = args.bundle;
    const bundleObject = validateBundle(bundleString);
    const { endoZipBase64Sha512 } = bundleObject;
    const uncompressedBundleBytes = textEncoder.encode(bundleString);
    const compressedBundleBytes = await gzip(uncompressedBundleBytes);
    const compressedSize = compressedBundleBytes.byteLength;
    const uncompressedSize = uncompressedBundleBytes.byteLength;
    const compressionSavings = compressedSize / uncompressedSize - 1;
    const txInfo = [
      `${formatBytesQuantity(uncompressedSize)} uncompressed`,
      `${formatBytesQuantity(compressedSize)} (${formatPercent(
        compressionSavings,
      )}) compressed`,
    ];

    let blockHeight: number | undefined;

    if (bundleString.length <= chunkSizeLimit) {
      const txSummary = "Submitting bundle in one transaction";
      toast.info([txSummary, ...txInfo].join(", "));

      const proposalMsg = makeInstallBundleMsg({
        compressedBundle: compressedBundleBytes,
        uncompressedSize: String(uncompressedSize),
        submitter: walletAddress,
      });
      try {
        const txResponse = await signAndBroadcast(proposalMsg, "bundle");
        if (!txResponse) {
          throw new Error("no response for bundle");
        }
        blockHeight = txResponse.height;
      } catch (error) {
        throw new Error(
          // @ts-expect-error it will be an Error, but null?.message would be fine anyway.
          `Transaction failed to submit bundle to chain: ${error?.message}`,
        );
      }
    } else {
      const { chunks, manifest } = await chunkBundle(
        compressedBundleBytes,
        chunkSizeLimit,
      );

      const txCount = chunks.length + 1;
      const txEn = pluralizeEn(txCount, "transaction", "transactions");
      const chunkEn = pluralizeEn(chunks.length, "chunk", "chunks");
      const txSummary = `Submitting bundle in ${txCount} ${txEn} (1 manifest and ${chunks.length} ${chunkEn})`;
      toast.info([txSummary, ...txInfo].join(", "));

      const proposalMsg = makeInstallBundleMsg({
        uncompressedSize: String(uncompressedSize),
        submitter: walletAddress,
        chunkedArtifact: manifest,
      });
      let chunkedArtifactId;
      try {
        const txResponse = await signAndBroadcast(proposalMsg, "bundle");
        if (!txResponse) {
          throw new Error(
            `No transaction response for attempt to submit manifest for bundle ${endoZipBase64Sha512}`,
          );
        }
        blockHeight = txResponse.height;
        const installBundleResponse = txResponse.msgResponses.find(
          (response) =>
            response.typeUrl === "/agoric.swingset.MsgInstallBundleResponse",
        );
        if (!installBundleResponse) {
          throw new Error(
            `No install bundle response found in manifest submission transaction response for bundle ${endoZipBase64Sha512}. This is a software defect. Please report.`,
          );
        }
        ({ chunkedArtifactId } = MsgInstallBundleResponse.decode(
          installBundleResponse.value,
        ));
        if (chunkedArtifactId === undefined) {
          throw new Error(
            `No chunked artifact identifier found in manifest submission transaction response for bundle ${endoZipBase64Sha512}. This is a software defect. Please report.`,
          );
        }
      } catch (error) {
        throw new Error(
          // @ts-expect-error error is going to be an Error, pinky swear.
          `Transaction failed to submit bundle manifest to chain for bundle ${endoZipBase64Sha512}: ${error?.message}`,
        );
      }

      if (chunkedArtifactId === undefined) {
        throw new Error(
          `No chunked artifact identifier found in transaction response. This is a software defect. Please report.`,
        );
      }

      for (let i = 0; i < chunks.length; i += 1) {
        const chunk = chunks[i];
        const proposalMsg = makeSendChunkMsg({
          chunkedArtifactId,
          chunkIndex: BigInt(i),
          chunkData: chunk,
          submitter: walletAddress,
        });
        try {
          const txResponse = await signAndBroadcast(
            proposalMsg,
            "bundle-chunk",
          );
          if (!txResponse) {
            throw new Error("no transaction response");
          }
          blockHeight = txResponse.height;
        } catch (error) {
          throw new Error(
            // @ts-expect-error error will truly be an Error, but ?. can handle it if it's not.
            `Transaction failed to submit bundle chunk ${i} of bundle ${endoZipBase64Sha512} to chain: ${error?.message}`,
          );
        }
      }
    }

    if (blockHeight === undefined) {
      throw new Error(
        "Bundle submitted but transaction response did not provide a block height. This should not occur. Please report.",
      );
    }

    await watchBundle(endoZipBase64Sha512, blockHeight);
    bundleFormRef.current?.reset();
  }

  function handleProposal(msgType: QueryParams["msgType"]) {
    return async (vals: ProposalArgs) => {
      if (!walletAddress) {
        toast.error("Wallet not connected.", { autoClose: 3000 });
        throw new Error("wallet not connected");
      }
      let proposalMsg;
      if (msgType === "coreEvalProposal") {
        if (!("evals" in vals)) throw new Error("Missing evals");
        proposalMsg = makeCoreEvalProposalMsg({
          ...vals,
          proposer: walletAddress,
        });
      }
      if (msgType === "textProposal") {
        proposalMsg = makeTextProposalMsg({
          ...vals,
          proposer: walletAddress,
        });
      }

      if (msgType === "communityPoolSpendProposal") {
        if (!("recipient" in vals) || !("amount" in vals)) {
          throw new Error("Missing recipient or amount");
        }
        proposalMsg = makeCommunityPoolSpendProposalMsg({
          ...vals,
          proposer: walletAddress,
        });
      }

      if (msgType === "parameterChangeProposal") {
        if (vals.msgType !== "parameterChangeProposal") return;
        proposalMsg = makeParamChangeProposalMsg({
          ...vals,
          proposer: walletAddress,
        });
      }
      if (!proposalMsg) throw new Error("Error parsing query or inputs.");

      try {
        await signAndBroadcast(proposalMsg, "proposal");
        proposalFormRef.current?.reset();
        corEvalFormRef.current?.reset();
      } catch (e) {
        console.error(e);
      }
    };
  }
  const [alertBox, setAlertBox] = useState(true);

  const canDeposit = useMemo(
    () =>
      !minDeposit ||
      minDeposit.some((cost) => {
        const balance = selectCoinBalance(accountBalances, cost.denom);
        return balance && coinIsGTE(balance, cost);
      }),
    [minDeposit, accountBalances],
  );

  return (
    <>
      {!canDeposit && alertBox && (
        <div
          className={
            "flex justify-center w-full max-w-7xl px-2 py-2 m-auto bg-white rounded-lg -mb-5"
          }
        >
          <div className={"basis-full"}>
            <div
              className={
                "toast text-center bg-lightblue2 p-4 text-blue font-light rounded-lg flex justify-between items-center"
              }
            >
              <div className={"basis-auto grow pr-4"}>
                You need to have{" "}
                <span className={"text-red font-black"}>
                  {renderCoins(minDeposit!)}
                </span>{" "}
                in your wallet to submit this action
              </div>
              <div className={"basis-auto"}>
                <svg
                  width="32"
                  height="32"
                  viewBox="0 0 32 32"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  className={"cursor-pointer"}
                  onClick={() => setAlertBox(false)}
                >
                  <rect width="32" height="32" rx="6" fill="white" />
                  <path
                    d="M20.5 11.5L11.5 20.5M11.5 11.5L20.5 20.5"
                    stroke="#0F3941"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
            </div>
          </div>
        </div>
      )}
      <Tabs
        tabs={[
          {
            title: "Text Proposal",
            msgType: "textProposal",
            content: (
              <ProposalForm
                ref={proposalFormRef}
                handleSubmit={handleProposal("textProposal")}
                titleDescOnly={true}
                title="Text Proposal"
                msgType="textProposal"
                governanceForumLink="https://community.agoric.com/c/governance/signaling-proposals/17"
                description={
                  <>
                    This is a governance proposal that can be used for signaling
                    support or agreement on a certain topic or idea. Text
                    proposals do not contain any code, and do not directly enact
                    changes after a passing vote.
                  </>
                }
              />
            ),
          },
          {
            title: "CoreEval Proposal",
            msgType: "coreEvalProposal",
            content: (
              <ProposalForm
                ref={corEvalFormRef}
                handleSubmit={handleProposal("coreEvalProposal")}
                titleDescOnly={false}
                title="CoreEval Proposal"
                msgType="coreEvalProposal"
                governanceForumLink="https://community.agoric.com/c/governance/core-eval/31"
                description={
                  <>
                    This is a governance proposal that executes code after a
                    passing vote. The JSON Permit grants{" "}
                    <a
                      className="cursor-pointer hover:text-gray-900 underline"
                      href="https://docs.agoric.com/guides/coreeval/permissions.html"
                    >
                      capabilities
                    </a>{" "}
                    and the JS Script can start or update a contract. These
                    files can be generated with the <Code>agoric run</Code>{" "}
                    command. For more details, see the{" "}
                    <a
                      className="cursor-pointer hover:text-gray-900 underline"
                      href="https://docs.agoric.com/guides/coreeval/"
                    >
                      official docs
                    </a>
                    .
                  </>
                }
              />
            ),
          },
          {
            title: "Install Bundle",
            msgType: "installBundle",
            content: (
              <BundleForm
                ref={bundleFormRef}
                title="Install Bundle"
                handleSubmit={handleBundle}
                description={
                  <>
                    The install bundle message deploys and installs an external
                    bundle generated during the <Code>agoric run</Code> process.
                    The resulting installation can be referenced in a{" "}
                    <a
                      className="cursor-pointer hover:text-gray-900 underline"
                      href="https://docs.agoric.com/guides/coreeval/"
                    >
                      CoreEval proposal
                    </a>{" "}
                    that starts or updates a contract.
                  </>
                }
              />
            ),
          },
          {
            title: "Parameter Change Proposal",
            msgType: "parameterChangeProposal",
            content: (
              <ProposalForm
                title="Parameter Change Proposal"
                handleSubmit={handleProposal("parameterChangeProposal")}
                description="This is a governance proposal to change chain configuration parameters."
                governanceForumLink="https://community.agoric.com/c/governance/parameter-changes/16"
                msgType="parameterChangeProposal"
                // XXX paramDescriptors should be passed in as prop
              />
            ),
          },
          {
            title: "Community Pool Spend",
            msgType: "communityPoolSpendProposal",
            content: (
              <ProposalForm
                title="Community Pool Spend Proposal"
                handleSubmit={handleProposal("communityPoolSpendProposal")}
                description="This is a governance proposal to spend funds from the community pool."
                governanceForumLink="https://community.agoric.com/c/governance/community-pool-spend-proposals/15"
                msgType="communityPoolSpendProposal"
              />
            ),
          },
        ]}
      />
    </>
  );
};

export { Agoric };
