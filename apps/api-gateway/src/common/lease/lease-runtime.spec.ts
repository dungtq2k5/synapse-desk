import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { Server, type CustomTransportStrategy } from '@nestjs/microservices';
import { Test } from '@nestjs/testing';
import { natsLeaseRuntime } from './lease-runtime';

/** A transport that only records whether it is listening. */
class RecordingTransport extends Server implements CustomTransportStrategy {
  listening = false;

  listen(callback: () => void) {
    this.listening = true;
    callback();
  }

  close() {
    this.listening = false;
  }

  on() {
    return undefined;
  }

  unwrap<T>(): T {
    return undefined as T;
  }
}

/** Stands for every provider whose shutdown hook quits a client, the Redis one among them. */
@Injectable()
class ShutdownProbe implements OnApplicationShutdown {
  shutDown = false;

  onApplicationShutdown() {
    this.shutDown = true;
  }
}

/**
 * Stepping down stops consuming, and closes nothing else.
 *
 * Against a REAL hybrid application: `connectMicroservice` shares the module
 * container, which is exactly what made `INestMicroservice.close()` shut the
 * whole application down from inside a lease step-down.
 */
describe('the NATS lease runtime', () => {
  it('**stops the consumer without running the application’s shutdown hooks**, and can start it again', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [ShutdownProbe],
    }).compile();
    const app = moduleRef.createNestApplication();
    const transport = new RecordingTransport();
    const consumer = app.connectMicroservice({ strategy: transport });
    await app.init();
    const dropped: string[] = [];
    const runtime = natsLeaseRuntime(consumer, () => dropped.push('sockets'));

    await runtime.activate();
    expect(transport.listening).toBe(true);

    await runtime.deactivate();
    expect(transport.listening).toBe(false);
    expect(dropped).toEqual(['sockets']);
    expect(app.get(ShutdownProbe).shutDown).toBe(false);

    await runtime.activate();
    expect(transport.listening).toBe(true);

    await app.close();
    expect(app.get(ShutdownProbe).shutDown).toBe(true);
  });
});
