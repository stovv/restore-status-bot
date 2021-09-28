FROM node:lts

RUN mkdir /app
WORKDIR /app

ADD . /app
RUN yarn

CMD yarn start