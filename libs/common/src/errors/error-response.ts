export interface ErrorDetail {
  property?: string;
  code?: string;
  message: string;
}

/** Standard error body (api-conventions section 6) */
export interface ErrorResponse {
  timestamp: string;
  statusCode: number;
  error: string;
  message: string;
  errorCode?: string;
  details?: ErrorDetail[];
  /** Only with APP_DEBUG=true */
  stack?: string;
}
