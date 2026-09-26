package com.synapsedesk.gateway.security;

import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication.Type;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/** Registers {@link PermissionInterceptor} on every route — `PermissionGuard`'s global scope. */
@Configuration
@ConditionalOnWebApplication(type = Type.SERVLET)
public class WebMvcConfig implements WebMvcConfigurer {

  private final PermissionInterceptor permissionInterceptor;

  public WebMvcConfig(PermissionInterceptor permissionInterceptor) {
    this.permissionInterceptor = permissionInterceptor;
  }

  @Override
  public void addInterceptors(InterceptorRegistry registry) {
    registry.addInterceptor(permissionInterceptor);
  }
}
