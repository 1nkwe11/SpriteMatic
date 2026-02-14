export type AccessTokenPayload = {
  sub: string;
  role: "USER" | "ADMIN";
  type: "access";
};

export type RefreshTokenPayload = {
  sub: string;
  type: "refresh";
};
