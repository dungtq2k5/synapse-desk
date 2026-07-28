import type { Config } from 'jest';

const baseConfig: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testEnvironment: 'node',
  testRegex: '(.[jt]s)$',
  transform: {
    '^.+\\.(t|j)s$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.json',
      },
    ],
  },
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/../src/$1',
    '^@synapsedesk/common$': '<rootDir>/libs/common/src',
    '^@synapsedesk/common/(.*)$': '<rootDir>/libs/common/src/$1',
    '^@synapsedesk/grpc-proto$': '<rootDir>/libs/grpc-proto/src',
    '^@synapsedesk/grpc-proto/(.*)$': '<rootDir>/libs/grpc-proto/src/$1',
  },
  transformIgnorePatterns: [
    'node_modules/(?!.*(@scure|otplib|@otplib|@noble|@faker-js))',
  ],
};

export default baseConfig;
