/**
 * Argon2id hash of a random string, verified when no usable account (or admin) exists, so the response time does not
 * reveal whether the email is known.
 */
export const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$8d902FJaiwI8/5qJbpHQtw$zrd8rExr4nBCpW2or00BuccYs2iboSx8VQTt3CapOsM';
