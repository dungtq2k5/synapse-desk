import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createServer, type Server } from 'node:http';
import { formatErrorMsg } from '@synapsedesk/common';
import { MetricsRegistry } from './metrics.registry';
import { JobMetricsCollector } from './job-metrics.collector';

/**
 * `/metrics`, on its OWN listener.
 *
 * **A separate port bound to the internal interface, not a route on the public
 * app.** The spec says "not via Nginx", and a distinct listener makes that
 * structural rather than a config rule Nginx has to keep enforcing correctly
 * forever — one misordered `location` block and the endpoint is public. A
 * metrics endpoint reachable from the internet is an inventory of your traffic
 * volumes, error rates and queue depths, offered to anyone who asks.
 *
 * It also means the guarantee is TESTABLE: a test asks the public listener
 * for `/metrics` and requires a 404, and that is a fact about this process
 * rather than about a proxy configuration living in another repository.
 *
 * A bare `node:http` server rather than a second Nest application: it serves one
 * route with no guards, no pipes, no interceptors and no body parsing, and a
 * second Nest app would bring all of them plus a second DI container.
 */
@Injectable()
export class MetricsServer implements OnApplicationShutdown {
  private readonly logger = new Logger(MetricsServer.name);

  private server?: Server;

  constructor(
    private readonly metrics: MetricsRegistry,
    private readonly jobs: JobMetricsCollector,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Started explicitly from `main.ts`, not from a lifecycle hook.
   *
   * The e2e bootstraps import the same `AppModule` and must NOT bind a port —
   * two suites running at once would collide on it, and the failure would be
   * `EADDRINUSE` in a suite that has nothing to do with metrics. Production
   * calls this; the tests drive `handle()` directly.
   */
  async listen(): Promise<void> {
    const port = this.configService.getOrThrow<number>('METRICS_PORT');
    // Defaults to loopback. The value is a real config knob because a
    // Kubernetes pod needs `0.0.0.0` for the scraper to reach it — but the
    // DEFAULT must be the safe one, so a deployment that forgets to think about
    // it is closed rather than open.
    const host = this.configService.get<string>('METRICS_HOST') ?? '127.0.0.1';

    this.server = createServer((request, response) => {
      void this.handle(request.url ?? '/', response);
    });

    await new Promise<void>((resolve) => {
      this.server!.listen(port, host, resolve);
    });

    this.logger.log(`📈 Metrics listening on http://${host}:${port}/metrics`);
  }

  /** The one route. Anything else is a 404, including `/`. */
  async handle(
    url: string,
    response: {
      writeHead: (status: number, headers?: Record<string, string>) => void;
      end: (body?: string) => void;
    },
  ): Promise<void> {
    if (!url.startsWith('/metrics')) {
      response.writeHead(404);
      response.end();
      return;
    }

    try {
      // Refreshed ON SCRAPE, so the job gauge is never staler than the scrape
      // interval and nothing polls in a pod nobody is scraping.
      await this.jobs.refresh();

      response.writeHead(200, { 'Content-Type': this.metrics.contentType });
      response.end(await this.metrics.scrape());
    } catch (error) {
      this.logger.error(`Scrape failed: ${formatErrorMsg(error)}`);
      response.writeHead(500);
      response.end();
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (!this.server) return;

    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
  }
}
