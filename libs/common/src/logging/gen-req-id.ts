import { type IncomingMessage, type ServerResponse } from 'http';
import { GenReqId, type ReqId } from 'pino-http';
import { v4 as uuidv4 } from 'uuid';

export const REQUEST_ID_HEADER = 'X-Request-Id';

const VALID_REQUEST_ID = /^[\w.:-]{1,128}$/;

/**
 * Keeps the caller's X-Request-Id when it is 1-128 characters of
 * `[A-Za-z0-9_.:-]` (it ends up in logs and headers), otherwise makes a
 * uuid v4. The id is echoed back.
 */
export const genReqId: GenReqId = (
  req: IncomingMessage,
  res: ServerResponse<IncomingMessage>,
) => {
  const header = req.headers['x-request-id'];
  const candidate = Array.isArray(header) ? header[0] : header;
  const id: ReqId =
    candidate && VALID_REQUEST_ID.test(candidate) ? candidate : uuidv4();
  res.setHeader(REQUEST_ID_HEADER, id.toString());
  return id;
};
