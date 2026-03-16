import rawLaunchSet from "../../scripts/launchSet.json";

type LaunchSetSourceItem = {
  asin: string;
  displayName: string;
  brand: string;
  category: string;
  primaryType: string;
  tags: string[];
  roomTags: string[];
  styleTags: string[];
  price: number;
  imageUrl: string;
  description: string;
  purchaseUrl: string;
  launchBatch: string;
  source: "launch-set";
  curationScore: number;
  allowedAbove60?: boolean;
  notes?: string;
  reviewedAt?: string;
};

export type LaunchSetProduct = LaunchSetSourceItem & {
  merchant: "Amazon.ca";
  isCurated: true;
  swipeEligible: true;
  imageApproved: true;
  active: true;
};

export const launchSet: LaunchSetProduct[] = (rawLaunchSet as LaunchSetSourceItem[]).map((product) => ({
  ...product,
  merchant: "Amazon.ca",
  isCurated: true,
  swipeEligible: true,
  imageApproved: true,
  active: true,
}));