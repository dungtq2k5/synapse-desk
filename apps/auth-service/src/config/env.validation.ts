import * as Joi from 'joi';
import { LOG_LEVELS, NODE_ENV_OPTIONS } from '@synapsedesk/common';

export const envValidationSchema = Joi.object({
  DATABASE_URL: Joi.string().required(),

  REDIS_URL: Joi.string().required(),

  NATS_URL: Joi.string().required(),

  GRPC_HOST: Joi.string().required(),
  GRPC_PORT: Joi.number().required(),

  // This service mints and verifies tokens; it never writes cookies.
  // The *_NAME and COOKIE_* vars are api-gateway concerns and are validated there.
  JWT_ACCESS_SECRET: Joi.string().required().min(32),
  JWT_ACCESS_EXPIRES_IN: Joi.string().required(),

  JWT_REFRESH_SECRET: Joi.string().required().min(32),
  JWT_REFRESH_EXPIRES_IN: Joi.string().required(),

  JWT_2FA_SECRET: Joi.string().required().min(32),
  JWT_2FA_EXPIRES_IN: Joi.string().required(),

  BCRYPT_ROUNDS: Joi.number().required(),

  MAIL_HOST: Joi.string().required(),
  MAIL_PORT: Joi.number().required(),
  MAIL_USER: Joi.string().required(),
  MAIL_PASSWORD: Joi.string().required(),

  GOOGLE_CLIENT_ID: Joi.string().required(),
  GOOGLE_CLIENT_SECRET: Joi.string().required(),
  GITHUB_CLIENT_ID: Joi.string().required(),
  GITHUB_CLIENT_SECRET: Joi.string().required(),

  OTP_LENGTH: Joi.number().required(),
  OTP_EXPIRY_MINUTES: Joi.number().required(),
  OTP_MAX_ATTEMPTS: Joi.number().required(),

  NODE_ENV: Joi.string()
    .required()
    .valid(...NODE_ENV_OPTIONS),
  LOG_LEVEL: Joi.string()
    .required()
    .valid(...LOG_LEVELS),
});
