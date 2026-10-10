import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequestContext } from '@synapsedesk/common';
import { AUTH_SCHEMES } from '../../common/config/swagger.config';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import {
  ApiFilterErrors,
  ApiWrappedResponse,
} from '../../common/decorators/api-response.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import {
  CreateWebhookEndpointDto,
  ListWebhookDeliveriesQueryDto,
  UpdateWebhookEndpointDto,
} from './dto/rest/webhook-endpoint.dto';
import {
  DeleteWebhookEndpointResponseDto,
  TestWebhookResponseDto,
  WebhookDeliveriesResponseDto,
  WebhookEndpointResponseDto,
  WebhookEndpointsResponseDto,
  WebhookEndpointWithSecretResponseDto,
  WebhookEventTypesResponseDto,
} from './dto/rest/webhook-endpoint-response.dto';
import { WebhookEndpointsService } from './webhook-endpoints.service';

/**
 * Outbound webhook management — tenant configuration, like billing and
 * settings, which is why `organization.read` / `organization.update` gate it
 * rather than any notification permission.
 *
 * **`webhook-endpoints`, never `/webhooks`** — that prefix is taken twice by
 * INBOUND (`billing/webhooks.controller.ts`, `inbound-email.controller.ts`),
 * and one word carrying two unrelated meanings is how the wrong controller
 * gets edited.
 */
@ApiTags('Webhook endpoints')
@ApiCookieAuth(AUTH_SCHEMES.access)
@Controller('webhook-endpoints')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class WebhookEndpointsController {
  constructor(private readonly webhooks: WebhookEndpointsService) {}

  @ApiOperation({ summary: "The tenant's endpoints. No secrets — ever" })
  @ApiWrappedResponse(WebhookEndpointsResponseDto)
  @ApiFilterErrors(['401', '403'])
  @RequirePermission('organization.read')
  @Get()
  list(
    @CurrentUser() context: RequestContext,
  ): Promise<WebhookEndpointsResponseDto> {
    return this.webhooks.list(context);
  }

  /**
   * Declared BEFORE `@Get(':id')`, or `event-types` becomes an id that fails
   * UUID parsing — the `by-number` lesson from the tickets controller.
   */
  @ApiOperation({
    summary: 'Every event type an endpoint can subscribe to',
    description:
      'The catalogue is what keeps "not subscribed" and "never happened" ' +
      'distinguishable — an integration reads it instead of guessing.',
  })
  @ApiWrappedResponse(WebhookEventTypesResponseDto)
  @ApiFilterErrors(['401', '403'])
  @RequirePermission('organization.read')
  @Get('event-types')
  listEventTypes(
    @CurrentUser() context: RequestContext,
  ): Promise<WebhookEventTypesResponseDto> {
    return this.webhooks.listEventTypes(context);
  }

  @ApiOperation({
    summary: 'One endpoint, with its subscribed types — explicitly',
  })
  @ApiWrappedResponse(WebhookEndpointResponseDto)
  @ApiFilterErrors(['400', '401', '403', '404'])
  @RequirePermission('organization.read')
  @Get(':id')
  get(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<WebhookEndpointResponseDto> {
    return this.webhooks.get(id, context);
  }

  @ApiOperation({
    summary: 'Register an endpoint. The secret is in THIS response only',
  })
  @ApiWrappedResponse(WebhookEndpointWithSecretResponseDto)
  @ApiFilterErrors(['400', '401', '403'])
  @RequirePermission('organization.update')
  @Post()
  create(
    @CurrentUser() context: RequestContext,
    @Body() dto: CreateWebhookEndpointDto,
  ): Promise<WebhookEndpointWithSecretResponseDto> {
    return this.webhooks.create(dto, context);
  }

  @ApiOperation({
    summary: 'Edit URL, description, subscriptions, or enable/disable',
  })
  @ApiWrappedResponse(WebhookEndpointResponseDto)
  @ApiFilterErrors(['400', '401', '403', '404'])
  @RequirePermission('organization.update')
  @Patch(':id')
  update(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWebhookEndpointDto,
  ): Promise<WebhookEndpointResponseDto> {
    return this.webhooks.update(id, dto, context);
  }

  @ApiOperation({ summary: 'Delete the endpoint and its delivery history' })
  @ApiWrappedResponse(DeleteWebhookEndpointResponseDto)
  @ApiFilterErrors(['400', '401', '403', '404'])
  @RequirePermission('organization.update')
  @Delete(':id')
  delete(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<DeleteWebhookEndpointResponseDto> {
    return this.webhooks.delete(id, context);
  }

  @ApiOperation({
    summary: 'Rotate the signing secret. Old one verifies for 24h more',
  })
  @ApiWrappedResponse(WebhookEndpointWithSecretResponseDto)
  @ApiFilterErrors(['400', '401', '403', '404'])
  @RequirePermission('organization.update')
  @Post(':id/rotate-secret')
  rotateSecret(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<WebhookEndpointWithSecretResponseDto> {
    return this.webhooks.rotateSecret(id, context);
  }

  /**
   * The delivery path, not a shortcut to it — same sender, same SSRF guard,
   * same signature. An unguarded "send a test event" is an SSRF endpoint with
   * a friendly name.
   */
  @ApiOperation({ summary: 'Send a signed test event through the real path' })
  @ApiWrappedResponse(TestWebhookResponseDto)
  @ApiFilterErrors(['400', '401', '403', '404'])
  @RequirePermission('organization.update')
  @Post(':id/test')
  test(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TestWebhookResponseDto> {
    return this.webhooks.test(id, context);
  }

  /**
   * What makes the feature operable: attempt counts, response codes and the
   * last error, without a support thread — and the only surface that makes the
   * auto-disable explicable rather than mysterious.
   */
  @ApiOperation({ summary: 'Recent deliveries, newest first' })
  @ApiWrappedResponse(WebhookDeliveriesResponseDto)
  @ApiFilterErrors(['400', '401', '403', '404'])
  @RequirePermission('organization.read')
  @Get(':id/deliveries')
  listDeliveries(
    @CurrentUser() context: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListWebhookDeliveriesQueryDto,
  ): Promise<WebhookDeliveriesResponseDto> {
    return this.webhooks.listDeliveries(id, query.limit, context);
  }
}
