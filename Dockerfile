# Builder
FROM node:24.13-alpine

RUN apk add --no-cache git pnpm

USER node
WORKDIR /home/node
ENV NODE_ENV=production

RUN git clone -b develop https://github.com/marcellejs/marcelle.git --depth 1 \
    && cd marcelle \
    && pnpm install && pnpm build

COPY --chown=node:node . ./Nig-Viz

WORKDIR /home/node/Nig-Viz
RUN pnpm install 
