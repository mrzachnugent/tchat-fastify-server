import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import fastify from 'fastify';
import { createContext, appRouter } from './trpc';
import ws from '@fastify/websocket';
import cors from '@fastify/cors';

const server = fastify({
  maxParamLength: 5000,
});

server.register(cors, { origin: '*' });

server.register(ws);

server.register(fastifyTRPCPlugin, {
  prefix: '/trpc',
  trpcOptions: { router: appRouter, createContext },
  useWSS: true,
});

server.listen({ port: 8080 }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Server listening at ${address}`);
});
