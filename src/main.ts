
import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app.component';
import 'zone.js'; // Import Zone.js to enable standard change detection

bootstrapApplication(AppComponent, {
  providers: []
}).catch((err) => console.error(err));
