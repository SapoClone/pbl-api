import { type IncomingMessage, type ServerResponse } from 'http';
import { GenReqId, type ReqId } from 'pino-http';
import { v4 as uuidv4 } from 'uuid';

export const REQUEST_ID_HEADER = 'X-Request-Id';

/** Keeps the caller's X-Request-Id (or makes a uuid v4) and echoes it back */
export const genReqId: GenReqId = (
  req: IncomingMessage,
  res: ServerResponse<IncomingMessage>,
) => {
  const header = req.headers['x-request-id'];
  const id: ReqId = (Array.isArray(header) ? header[0] : header) || uuidv4();
  res.setHeader(REQUEST_ID_HEADER, id.toString());
  return id;
};
