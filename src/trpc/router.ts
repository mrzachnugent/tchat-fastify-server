import { createRouter } from './context';
import { Subscription } from '@trpc/server';
import { z } from 'zod';

import { EventEmitter } from 'events';
interface MyEvents {
  otherTyping: (data: {
    text: string;
    isSharable: boolean;
    user: User;
  }) => void;
  newMessage: (data: { message: string; room: string; user: User }) => void;
}

declare interface MyEventEmitter {
  on<U extends keyof MyEvents>(event: U, listener: MyEvents[U]): this;
  once<U extends keyof MyEvents>(event: U, listener: MyEvents[U]): this;
  emit<U extends keyof MyEvents>(
    event: U,
    ...args: Parameters<MyEvents[U]>
  ): boolean;
}

class MyEventEmitter extends EventEmitter {}

const ee = new MyEventEmitter();

type User = {
  id: string;
  name: string;
  room: string;
  avatarSrc: string;
};

const zUser = z.object({
  id: z.string(),
  name: z.string(),
  room: z.string(),
  avatarSrc: z.string(),
});

const users: Record<string, User> = {};

interface IMessage {
  room: string;
  message: string;
  user: User;
  likes: { [key: string]: boolean };
  replies: Omit<IMessage, 'replies'>[] | null;
}

const rooms: {
  [key: string]: {
    messages: IMessage[];
    users: User[];
  };
} = {
  Main: {
    messages: [],
    users: [
      {
        avatarSrc:
          'https://lh3.googleusercontent.com/LJOjfIyAWQgx5NTHw1kI3-w2wge2y6JjPWDr8B-_WcCeJ6HmcyjNwdAF5SA8xC-LWKoX2tKdIFv_2K7iowUqbn0hdFf3lgzfH6JOzKQ=w600',
        id: '1',
        name: 'Snoop Dogg',
        room: 'Main',
      },
      {
        avatarSrc:
          'https://pbs.twimg.com/media/FEaFK4OWUAAlgiV?format=jpg&name=medium',
        id: '2',
        name: 'Jimmy Fallon',
        room: 'Main',
      },
    ],
  },
};

export const appRouter = createRouter()
  .query('tchat.getUserById', {
    input: z.string().nullable(),
    async resolve({ input }) {
      if (!input) return null;
      return users[input];
    },
  })
  .query('tchat.getChatByRoom', {
    input: z.string(),
    async resolve({ input }) {
      return rooms[input];
    },
  })
  .mutation('tchat.createUser', {
    input: z.object({
      name: z.string().min(3),
      id: z.string().min(3),
      room: z.string().min(3),
      avatarSrc: z.string().min(3),
    }),
    async resolve({ input }) {
      const user: User = { ...input };
      users[user.id] = user;
      rooms[input.room].users.push(user);
      return user;
    },
  })
  .mutation('tchat.whatchaTyping', {
    input: z.object({
      text: z.string(),
      isSharable: z.boolean(),
      user: zUser,
    }),
    async resolve({ input }) {
      ee.emit('otherTyping', input);
    },
  })
  .mutation('tchat.sendMessage', {
    input: z.object({
      message: z.string(),
      room: z.string(),
      user: zUser,
    }),
    async resolve({ input }) {
      rooms[input.room].messages.unshift({
        ...input,
        likes: {},
        replies: null,
      });
      ee.emit('newMessage', input);
      ee.emit('otherTyping', {
        isSharable: true,
        text: '',
        user: input.user,
      });
    },
  })
  .subscription('tchat.messages', {
    input: z.object({
      room: z.string(),
    }),
    resolve({ input }) {
      return new Subscription<IMessage>((emit) => {
        const newMessage = (data: {
          message: string;
          room: string;
          user: User;
        }) => {
          if (input.room === data.room) {
            emit.data({ ...data, replies: null, likes: {} });
          }
        };
        ee.on('newMessage', newMessage);
        return () => {
          ee.off('newMessage', newMessage);
        };
      });
    },
  })
  .subscription('tchat.whosTyping', {
    input: z.object({
      room: z.string(),
    }),
    resolve({ input }) {
      return new Subscription<{ text: string; user: User }>((emit) => {
        const newTyping = (userTyping: {
          text: string;
          isSharable: boolean;
          user: User;
        }) => {
          if (input.room === userTyping.user.room && userTyping.isSharable) {
            emit.data(userTyping);
          }
        };

        ee.on('otherTyping', newTyping);

        return () => {
          ee.off('otherTyping', newTyping);
        };
      });
    },
  });

// export type definition of API
export type AppRouter = typeof appRouter;
