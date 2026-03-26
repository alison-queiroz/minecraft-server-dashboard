// This file can be replaced during build by using the `fileReplacements` array.
// `ng build` replaces `environment.ts` with `environment.prod.ts`.
// The list of file replacements can be found in `angular.json`.

export const environment = {
  production: false,
  serverAddress: 'exvegan.duckdns.org',
  serverIP: '163.176.228.223',
  statusApiUrl: 'https://api.mcsrvstat.us/3/',
  bedrockStatusApiUrl: 'https://api.mcsrvstat.us/bedrock/3/',
  playerRefreshInterval: 30_000,
  statusRefreshInterval: 60_000,
  mapBaseUrl: 'https://exvegan-minecraft-map.duckdns.org/',
  firebaseConfig: {
    apiKey: 'AIzaSyAeOOLsxweoOo8zwOfSJ6s4_mCmGIETzCo',
    authDomain: 'exvegan-minecraft-server.firebaseapp.com',
    projectId: 'exvegan-minecraft-server',
    storageBucket: 'exvegan-minecraft-server.firebasestorage.app',
    messagingSenderId: '1058370885538',
    appId: '1:1058370885538:web:b764e1c45622008eee84fb',
    measurementId: 'G-ZBPXEDVHHD',
  },
};

/*
 * For easier debugging in development mode, you can import the following file
 * to ignore zone related error stack frames such as `zone.run`, `zoneDelegate.invokeTask`.
 *
 * This import should be commented out in production mode because it will have a negative impact
 * on performance if an error is thrown.
 */
// import 'zone.js/plugins/zone-error';  // Included with Angular CLI.
