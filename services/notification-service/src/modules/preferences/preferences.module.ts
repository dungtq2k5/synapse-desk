import { Global, Module } from '@nestjs/common';
import { PreferenceResolver } from './preference-resolver.service';
import { PreferencesService } from './preferences.service';

/**
 * `@Global` because BOTH halves of Domain E need it: the write path resolves a
 * preference per recipient per channel, and the read path serves the settings
 * screen. A non-global module would be imported by every feature module here,
 * which is the shape that eventually gets a second provider by accident.
 */
@Global()
@Module({
  providers: [PreferenceResolver, PreferencesService],
  exports: [PreferenceResolver, PreferencesService],
})
export class PreferencesModule {}
