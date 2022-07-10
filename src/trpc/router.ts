import { createRouter } from './context';
import { Subscription, TRPCError } from '@trpc/server';
import { z } from 'zod';

import { EventEmitter } from 'events';
interface MyEvents {
  otherTyping: (data: {
    text: string;
    isSharable: boolean;
    user: User;
  }) => void;
  newMessage: (data: IMessage) => void;
  modifiedMessage: (data: IMessage) => void;
  onlineStatuses: (data: User) => void;
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
  isOnline: boolean;
  lastSeen: Date;
};

const zUser = z.object({
  id: z.string(),
  name: z.string(),
  room: z.string(),
  avatarSrc: z.string(),
  isOnline: z.boolean(),
});

const users: Record<string, User> = {
  '0': {
    avatarSrc:
      'https://lh3.googleusercontent.com/LJOjfIyAWQgx5NTHw1kI3-w2wge2y6JjPWDr8B-_WcCeJ6HmcyjNwdAF5SA8xC-LWKoX2tKdIFv_2K7iowUqbn0hdFf3lgzfH6JOzKQ=w600',
    id: '0',
    name: 'Snoop Dogg',
    room: 'Main',
    isOnline: false,
    lastSeen: new Date(),
  },
  '1': {
    avatarSrc:
      'https://pbs.twimg.com/media/FEaFK4OWUAAlgiV?format=jpg&name=medium',
    id: '1',
    name: 'Jimmy Fallon',
    room: 'Main',
    isOnline: false,
    lastSeen: new Date(),
  },
};

interface IMessage {
  id: string;
  room: string;
  message: string;
  user: User;
  likes: { [key: string]: boolean };
  replies: Omit<IMessage, 'replies'>[] | null;
}

const rooms: {
  [key: string]: {
    messages: IMessage[];
    users: typeof users;
  };
} = {
  Main: {
    messages: [],
    users: users,
  },
};

// who is currently typing, key is `id`
const currentlyTyping: Record<string, { lastTyped: Date }> =
  Object.create(null);

// every 1s, clear old "isTyping"
const interval = setInterval(() => {
  let updated = false;
  const now = Date.now();
  let user;
  for (const [key, value] of Object.entries(currentlyTyping)) {
    if (now - value.lastTyped.getTime() > 3e3) {
      user = users[key];
      delete currentlyTyping[key];
      updated = true;
    }
  }
  if (updated && user) {
    ee.emit('otherTyping', { isSharable: true, text: '', user });
  }
}, 3e3);
process.on('SIGTERM', () => clearInterval(interval));

export const appRouter = createRouter()
  .query('tchat.getChatByRoom', {
    input: z.string(),
    async resolve({ input }) {
      return rooms[input];
    },
  })
  .mutation('tchat.login', {
    input: z.object({
      user: zUser,
      room: z.string(),
    }),
    async resolve({ input }) {
      users[input.user.id].isOnline = true;
      users[input.user.id].lastSeen = new Date();
      ee.emit('onlineStatuses', { ...users[input.user.id], isOnline: true });
      return rooms[input.room];
    },
  })
  .mutation('tchat.whatchaTyping', {
    input: z.object({
      text: z.string(),
      isSharable: z.boolean(),
      user: zUser,
    }),
    async resolve({ input }) {
      currentlyTyping[input.user.id] = { lastTyped: new Date() };
      users[input.user.id].lastSeen = new Date();
      ee.emit('otherTyping', { ...input, user: users[input.user.id] });
    },
  })

  .mutation('tchat.toggleLike', {
    input: z.object({
      messageId: z.string(),
      room: z.string(),
      user: zUser,
    }),
    async resolve({ input }) {
      const messageIndex = rooms[input.room].messages.findIndex(
        (e) => e.id === input.messageId
      );
      users[input.user.id].lastSeen = new Date();
      if (rooms[input.room].messages[messageIndex].likes[input.user.id]) {
        delete rooms[input.room].messages[messageIndex].likes[input.user.id];
      } else {
        rooms[input.room].messages[messageIndex].likes[input.user.id] = true;
      }
      ee.emit('modifiedMessage', rooms[input.room].messages[messageIndex]);
    },
  })
  .mutation('tchat.sendMessage', {
    input: z.object({
      message: z.string(),
      room: z.string(),
      user: zUser,
    }),
    async resolve({ input }) {
      users[input.user.id].lastSeen = new Date();
      const newMessage = {
        ...input,
        user: users[input.user.id],
        likes: {},
        replies: null,
        id: Date.now().toString(),
      };
      rooms[input.room].messages.unshift(newMessage);
      ee.emit('newMessage', newMessage);
      ee.emit('otherTyping', {
        isSharable: true,
        text: '',
        user: users[input.user.id],
      });
    },
  })
  .mutation('tchat.logout', {
    input: z.object({
      user: zUser,
    }),
    async resolve({ input }) {
      users[input.user.id].isOnline = false;
      users[input.user.id].lastSeen = new Date();
      ee.emit('onlineStatuses', users[input.user.id]);
    },
  })
  .subscription('tchat.messages', {
    input: z.object({
      room: z.string(),
      userId: z.string().optional(),
    }),
    resolve({ input }) {
      if (!input?.userId || !users[input.userId]) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      return new Subscription<IMessage>((emit) => {
        const newMessage = (data: IMessage) => {
          if (input.room === data.room) {
            emit.data(data);
          }
        };
        ee.on('newMessage', newMessage);
        return () => {
          ee.off('newMessage', newMessage);
        };
      });
    },
  })
  .subscription('tchat.messageEdit', {
    input: z.object({
      room: z.string(),
      userId: z.string().optional(),
    }),
    resolve({ input }) {
      if (!input?.userId || !users[input.userId]) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }
      return new Subscription<IMessage>((emit) => {
        const edittedMessage = (data: IMessage) => {
          if (input.room === data.room) {
            emit.data(data);
          }
        };
        ee.on('modifiedMessage', edittedMessage);
        return () => {
          ee.off('modifiedMessage', edittedMessage);
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
  })
  .subscription('tchat.whosOnline', {
    input: z.object({
      room: z.string(),
    }),
    resolve({ input }) {
      return new Subscription<User>((emit) => {
        const whosOnline = (data: User) => {
          if (input.room === data.room) {
            emit.data(data);
          }
        };

        ee.on('onlineStatuses', whosOnline);

        return () => {
          ee.off('onlineStatuses', whosOnline);
        };
      });
    },
  });

// export type definition of API
export type AppRouter = typeof appRouter;
