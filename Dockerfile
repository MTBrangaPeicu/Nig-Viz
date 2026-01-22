# Builder
FROM node:24.13-alpine

RUN apk add --no-cache git pnpm

USER node
WORKDIR /home/node
ENV NODE_ENV=production

# dev or backend (dev by default)
ENV SERVER=dev

RUN git clone -b develop https://github.com/marcellejs/marcelle.git --depth 1 \
    && cd marcelle \
    && pnpm install && pnpm build

COPY --chown=node:node . ./Nig-Viz

WORKDIR /home/node/Nig-Viz
RUN sed -i 's/mongodb:\/\/localhost:/mongodb:\/\/mongodb:/g' ./backend/config/default.json
RUN pnpm install

# Frontend port
EXPOSE 5173
# Backend port 3030
EXPOSE 3030 

ENTRYPOINT ["sh","-c", "npm run $SERVER"]
