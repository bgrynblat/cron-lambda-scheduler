FROM node:alpine

EXPOSE 3131

WORKDIR /usr/app

COPY package.json .
COPY *.js .
RUN npm install

CMD ["node", "index.js"]
