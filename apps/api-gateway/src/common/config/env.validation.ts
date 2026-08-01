import { COOKIE_SAMESITE_OPTIONS, NODE_ENV_OPTIONS } from '@synapsedesk/common';
import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  PORT: Joi.number().required(),
  GLOBAL_PREFIX: Joi.string().required(),
  CORS: Joi.string().required(),

  NODE_ENV: Joi.string()
    .valid(...NODE_ENV_OPTIONS)
    .required(),

  JWT_ACCESS_NAME: Joi.string().required(),
  JWT_ACCESS_PUBLIC_KEY_PATH: Joi.string().required(),

  JWT_REFRESH_NAME: Joi.string().required(),

  JWT_2FA_NAME: Joi.string().required(),
  // Public half of the 2FA pair — separate from the access pair, so a challenge
  // token cannot verify where an access token is expected and vice versa. The
  // gateway holds no signing material of any kind: it verifies, never mints.
  JWT_2FA_PUBLIC_KEY_PATH: Joi.string().required(),

  // Short-lived token carrying a multi-tenant login between its two legs.
  TENANT_SELECTION_NAME: Joi.string().required(),

  // Opaque "remember this device" secret. Not a JWT — hence the different
  // prefix; it is never verified, only looked up.
  DEVICE_TOKEN_NAME: Joi.string().required(),

  COOKIE_ACCESS_MAX_AGE: Joi.number().required(),
  COOKIE_REFRESH_MAX_AGE: Joi.number().required(),
  COOKIE_2FA_MAX_AGE: Joi.number().required(),
  COOKIE_DEVICE_MAX_AGE: Joi.number().required(),
  COOKIE_TENANT_SELECTION_MAX_AGE: Joi.number().required(),

  COOKIE_SAMESITE: Joi.string()
    .required()
    .valid(...COOKIE_SAMESITE_OPTIONS),

  AUTH_SERVICE_URL: Joi.string().required(),
});
