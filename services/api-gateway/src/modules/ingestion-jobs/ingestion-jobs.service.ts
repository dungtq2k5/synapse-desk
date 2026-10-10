import { Injectable } from '@nestjs/common';
import { RequestContext } from '@synapsedesk/common';
import { PaginationResponseDto } from '../../common/dto/rest/pagination-response.dto';
import { IngestionJobsGrpcClient } from './ingestion-jobs-grpc.client';
import {
  toIngestionJobPageDto,
  toIngestionJobResponseDto,
  toListIngestionJobsRequest,
} from './ingestion-job.mapper';
import { ListIngestionJobsQueryDto } from './dto/rest/ingestion-job.dto';
import { IngestionJobResponseDto } from './dto/rest/ingestion-job-response.dto';

/** The pipeline worklist, mapped for REST. */
@Injectable()
export class IngestionJobsService {
  constructor(private readonly client: IngestionJobsGrpcClient) {}

  async list(
    query: ListIngestionJobsQueryDto,
    context: RequestContext,
  ): Promise<PaginationResponseDto<IngestionJobResponseDto>> {
    return toIngestionJobPageDto(
      await this.client.list(toListIngestionJobsRequest(query), context),
    );
  }

  async get(
    id: string,
    context: RequestContext,
  ): Promise<IngestionJobResponseDto> {
    return toIngestionJobResponseDto(await this.client.get(id, context));
  }

  /** @returns the NEW job — retry never reuses the row it was given. */
  async retry(
    id: string,
    context: RequestContext,
  ): Promise<IngestionJobResponseDto> {
    return toIngestionJobResponseDto(await this.client.retry(id, context));
  }

  /**
   * Cancels a job.
   *
   * The wire's `cancelled` flag is discarded: the only false it could carry is
   * a failure, and a failure arrives as an exception.
   */
  async cancel(id: string, context: RequestContext): Promise<void> {
    await this.client.cancel(id, context);
  }

  async listForDocument(
    documentId: string,
    context: RequestContext,
  ): Promise<PaginationResponseDto<IngestionJobResponseDto>> {
    return toIngestionJobPageDto(
      await this.client.listForDocument(documentId, context),
    );
  }
}
