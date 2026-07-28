export type JwtPayload = {
  sub: string;
  email: string;
};

export type TwoFactorJwtPayload = Pick<JwtPayload, 'sub'> & {
  is2faPending: true;
};
