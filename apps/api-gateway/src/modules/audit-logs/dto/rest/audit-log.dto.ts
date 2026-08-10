import { Type } from 'class-transformer';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { SearchPaginationDto } from '../../../../common/dto/rest/search-pagination.dto';

export class ListAuditLogsQueryDto extends SearchPaginationDto {
  /**
   * A free string, not an `@IsIn(AUDIT_ACTIONS)`.
   *
   * The catalogue of actions grows in whichever service publishes them, and a
   * gateway enum would reject a brand-new action the moment a service started
   * emitting it — a validation error for an event that genuinely happened. The
   * value only ever reaches an equality filter, so an unknown one is an empty
   * result rather than a risk.
   */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  readonly action?: string;

  @IsOptional()
  @IsUUID('4')
  readonly userId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  readonly resourceType?: string;

  @IsOptional()
  @IsUUID('4')
  readonly resourceId?: string;

  @IsOptional()
  @Type(() => Date)
  readonly from?: Date;

  @IsOptional()
  @Type(() => Date)
  readonly to?: Date;
}
