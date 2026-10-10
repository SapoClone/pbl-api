export type AuthConfig = {
  privateKey: string;
  keyId: string;
  issuer: string;
  audience: string;
  expires: string;
  refreshExpires: string;
  forgotSecret: string;
  forgotExpires: string;
  confirmEmailSecret: string;
  confirmEmailExpires: string;
};
