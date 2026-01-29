import type { Coin } from "../types/bank";

export type CostPerByte = [amount: number, denom: string];
export type BundleCost = [amount: number, denom: string];

export const calculateBundleCost = (
  costPerByte: CostPerByte | undefined,
  sizeBytes: number | undefined,
): BundleCost | null => {
  if (!costPerByte || !sizeBytes) return null;
  return [costPerByte[0] * sizeBytes, costPerByte[1]];
};

export const calculateRemainingCost = (
  bundleCost: BundleCost | null,
  accountBalances?: Coin[],
): number | null => {
  if (!bundleCost) return null;
  if (!accountBalances) return bundleCost[0];
  const [amount, denom] = bundleCost;
  const denomBalance = accountBalances.find((x) => x.denom === denom);
  if (!denomBalance) return amount;
  return Math.max(amount - Number(denomBalance.amount), 0);
};

export const hasSufficientBalance = (
  bundleCost: BundleCost | null,
  accountBalances?: Coin[],
): boolean | null => {
  const remaining = calculateRemainingCost(bundleCost, accountBalances);
  if (remaining === null) return null;
  return remaining === 0;
};
