import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { IsString, validateSync } from 'class-validator';
import { OptionalNonNull, OptionalNullable } from './optional.decorator';

class Body {
  @OptionalNonNull()
  @IsString()
  readonly note?: string;

  @OptionalNullable()
  @IsString()
  readonly dob?: string | null;
}

const messages = (plain: object) =>
  validateSync(plainToInstance(Body, plain)).flatMap((error) =>
    Object.values(error.constraints ?? {}),
  );

describe('OptionalNonNull', () => {
  it('**leaves an absent field alone**, and validates a present one', () => {
    expect(messages({})).toEqual([]);
    expect(messages({ note: 'hi' })).toEqual([]);
    expect(messages({ note: 42 })).toEqual(['note must be a string']);
  });

  it('**refuses an explicit `null`, naming the field and saying to leave it out**', () => {
    expect(messages({ note: null })).toContain(
      "note can't be null; leave it out instead",
    );
  });
});

describe('OptionalNullable', () => {
  it('**accepts absent and `null` alike**, and validates a present value', () => {
    expect(messages({})).toEqual([]);
    expect(messages({ dob: null })).toEqual([]);
    expect(messages({ dob: 7 })).toEqual(['dob must be a string']);
  });
});
