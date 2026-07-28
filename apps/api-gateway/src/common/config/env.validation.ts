import { NODE_ENV_OPTIONS } from '@synapsedesk/common';
import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  PORT: Joi.number().required(),
  GLOBAL_PREFIX: Joi.string().required(),
  CORS: Joi.string().required(),
  // Must be spread — valid() takes varargs, so passing the array itself would
  // make the array the only accepted value.
  NODE_ENV: Joi.string()
    .valid(...NODE_ENV_OPTIONS)
    .required(),

  JWT_ACCESS_NAME: Joi.string().required(),
  JWT_REFRESH_NAME: Joi.string().required(),
  JWT_2FA_NAME: Joi.string().required(),

  COOKIE_MAX_AGE: Joi.number().required(),
  COOKIE_2FA_MAX_AGE: Joi.number().required(),
  COOKIE_SAMESITE: Joi.string().required(),

  AUTH_SERVICE_URL: Joi.string().required(),
});
