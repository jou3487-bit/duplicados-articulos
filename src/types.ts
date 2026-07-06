/**
 * Types and interfaces for the Oracle Fusion Product Hub Master Data Classifier
 */

export interface ClassifiedItem {
  id?: string;
  originalDescription: string;
  purchasingCategory: string;
  standardizedDescription: string;
  brand: string;
  partNumber: string;
  uom: string;
  confidence: number;
  explanation: string;
  createdAt?: string;
}

export interface ClassificationResponse {
  items: ClassifiedItem[];
}

export interface OracleFusionPayload {
  ItemNumber: string;
  ItemDescription: string;
  PurchasingCategory: string;
  ItemClass: string;
  Status: string;
  PrimaryUOM: string;
  Attributes: {
    Brand: string;
    PartNumber: string;
    StandardizedDescription: string;
    SourceSystem: string;
  };
}
