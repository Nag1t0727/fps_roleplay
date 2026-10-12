import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'./tests/browser',timeout:90000,workers:1,
  use:{baseURL:'http://127.0.0.1:8080',viewport:{width:1440,height:1000},channel:'chrome',headless:true,launchOptions:{args:['--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']}},
  webServer:{command:'npm start',url:'http://127.0.0.1:8080',reuseExistingServer:!process.env.CI},
});
