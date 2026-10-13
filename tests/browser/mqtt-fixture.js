import {test as base,expect} from '@playwright/test';
import {Aedes} from 'aedes';
import {WebSocketServer,createWebSocketStream} from 'ws';

export const test=base.extend({
  browser:async({browser},use)=>{
    if(process.env.MQTT_LIVE==='1'){await use(browser);return;}
    const broker=await Aedes.createBroker({maxClientsIdLength:80}),server=new WebSocketServer({port:0,host:'127.0.0.1'});
    await new Promise(resolve=>server.once('listening',resolve));
    server.on('connection',socket=>broker.handle(createWebSocketStream(socket)));
    const original=browser.newContext.bind(browser);
    browser.newContext=async options=>{
      const context=await original(options);
      await context.route('**/network-config.js*',route=>route.fulfill({contentType:'text/javascript',body:`export const mqttBrokers=['ws://127.0.0.1:${server.address().port}'];`}));
      return context;
    };
    try{await use(browser);}finally{
      browser.newContext=original;
      for(const socket of server.clients)socket.terminate();
      await new Promise(resolve=>server.close(resolve));await new Promise(resolve=>broker.close(resolve));
    }
  },
});
export {expect};
