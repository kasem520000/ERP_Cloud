import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { env } from '@erp/config';
import {
  changePasswordRequestSchema,
  loginRequestSchema,
  logoutRequestSchema,
  refreshRequestSchema,
  type ChangePasswordRequest,
  type LoginRequest,
  type LoginResponse,
  type RefreshRequest,
} from '@erp/contracts';

import { ZodValidationPipe } from '../../../common/pipes/zod-validation.pipe.js';
import { getAuthContext } from '../../../request-context/request-context.js';
import { zodApiBody } from '../../../openapi/zod-api-body.js';
import { Public } from '../decorators/public.decorator.js';
import { RateLimit } from '../decorators/rate-limit.decorator.js';

import { AuthService } from './auth.service.js';

/** API_CONTRACT §1 — Auth & Identity. */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @RateLimit({ name: 'login', limit: env.RATE_LIMIT_LOGIN_PER_MINUTE, windowMs: 60_000 })
  @zodApiBody(loginRequestSchema)
  @ApiOperation({ summary: 'Exchange credentials for an access/refresh token pair' })
  @ApiResponse({ status: 200, description: 'Authenticated' })
  @ApiResponse({ status: 401, description: 'Invalid credentials (UNAUTHENTICATED)' })
  @ApiResponse({ status: 423, description: 'Tenant suspended (TENANT_SUSPENDED)' })
  @ApiResponse({ status: 429, description: 'Login bucket exhausted or account locked (RATE_LIMITED)' })
  async login(
    @Body(new ZodValidationPipe(loginRequestSchema)) body: LoginRequest,
    @Req() request: Request,
  ): Promise<{ data: LoginResponse }> {
    const data = await this.auth.login(body, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
    return { data };
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @RateLimit({ name: 'auth', limit: env.RATE_LIMIT_DEFAULT_PER_MINUTE, windowMs: 60_000 })
  @zodApiBody(refreshRequestSchema)
  @ApiOperation({ summary: 'Rotate a refresh token and issue a new access token' })
  @ApiResponse({ status: 200, description: 'Rotated pair' })
  @ApiResponse({ status: 401, description: 'Unknown, expired or reused token (family revoked)' })
  async refresh(
    @Body(new ZodValidationPipe(refreshRequestSchema)) body: RefreshRequest,
    @Req() request: Request,
  ): Promise<{ data: LoginResponse }> {
    const data = await this.auth.refresh(body, {
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    });
    return { data };
  }

  @Post('logout')
  @HttpCode(204)
  @zodApiBody(logoutRequestSchema)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke every active refresh token of the current user' })
  @ApiResponse({ status: 204, description: 'Logged out' })
  async logout(): Promise<void> {
    await this.auth.logout(getAuthContext());
  }

  @Post('change-password')
  @HttpCode(204)
  @zodApiBody(changePasswordRequestSchema)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change the caller password and revoke all sessions' })
  @ApiResponse({ status: 204, description: 'Password changed' })
  @ApiResponse({ status: 400, description: 'Wrong current password or policy rejection' })
  async changePassword(
    @Body(new ZodValidationPipe(changePasswordRequestSchema)) body: ChangePasswordRequest,
  ): Promise<void> {
    await this.auth.changePassword(getAuthContext(), body);
  }
}
