/** Base KEV record from CISA catalog. */
export interface KevBaseEntry {
  cveID: string;
  vendorProject: string;
  product: string;
  vulnerabilityName: string;
  dateAdded: string;
  shortDescription: string;
  requiredAction: string;
  dueDate: string;
  knownRansomwareCampaignUse: 'Known' | 'Unknown' | 'No';
  notes: string;
  cwes: string[];
}

/** One daily EPSS observation (score is a 0–1 probability). */
export interface EpssPoint {
  date: string;
  score: number;
}

/** An NVD reference tagged as directly actionable for remediation. */
export interface CveReference {
  url: string;
  tag: 'Patch' | 'Vendor Advisory';
}

/** CVE enrichment from NVD (score, severity, etc.) and FIRST EPSS. */
export interface CveEnrichment {
  cveId: string;
  baseScore: number | null;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE' | null;
  vectorString: string | null;
  published: string | null;
  lastModified: string | null;
  nvdUrl: string;
  epssScore: number | null;
  epssPercentile: number | null;
  // ~30 days of daily EPSS history, oldest→newest, for the trend sparkline.
  epssHistory: EpssPoint[] | null;
  // Patch / Vendor Advisory links straight from NVD — up to 3, patch-tagged first.
  references: CveReference[];
}

/** Merged KEV + CVE entry for the dashboard. */
export type KevEntry = KevBaseEntry & {
  cve: CveEnrichment | null;
};

/** Single news/link item returned by the backend search. */
export interface NewsLinkItem {
  title: string;
  url: string;
}

/** Stored value per CVE for news links (persisted in localStorage). */
export interface StoredNewsLinks {
  links: NewsLinkItem[];
  fetchedAt?: number;
}

/** Runtime state for one CVE in the news links column. */
export interface NewsLinksState {
  links: NewsLinkItem[];
  loading?: boolean;
  error?: string;
}
