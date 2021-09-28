FROM node:lts

RUN mkdir /app
WORKDIR /app

COPY package.json yarn.lock /app/
RUN yarn

ADD . /app
CMD yarn start