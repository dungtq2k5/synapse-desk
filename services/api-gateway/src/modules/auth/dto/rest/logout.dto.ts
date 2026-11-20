import { IsBoolean } from 'class-validator';
import { OptionalNonNull } from '../../../../common/decorators/optional.decorator';

export class LogoutDto {
  /** Log out of all devices. */
  @OptionalNonNull()
  @IsBoolean()
  readonly allDevices?: boolean;
}
