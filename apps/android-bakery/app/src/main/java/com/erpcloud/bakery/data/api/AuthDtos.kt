package com.erpcloud.bakery.data.api

import kotlinx.serialization.Serializable

/**
 * عقودُ المصادقة والجلسة — من packages/contracts/src/platform/auth.ts
 * (مطابقةٌ حرفيّةً لـ docs/ANDROID_REP_APP_API_RESPONSES.json).
 */

@Serializable
data class LoginRequest(
    val email: String,
    val password: String,
    val tenantCode: String,
    val mfaCode: String? = null,
)

@Serializable
data class RefreshRequest(
    val refreshToken: String,
)

/**
 * `POST /auth/change-password` — الجسم strict: {current, new} حرفيًّا.
 * النجاحُ 204، والخادمُ يُبطل كلَّ الجلسات بعده (سياسة الأمان).
 */
@Serializable
data class ChangePasswordRequest(
    val current: String,
    val new: String,
)

@Serializable
data class UserDto(
    val id: String,
    val email: String,
    val fullName: String,
    val phone: String? = null,
    val status: String = "active",
    val isPlatformAdmin: Boolean = false,
    val platformRoles: List<String> = emptyList(),
    val mustChangePassword: Boolean = false,
    val lastLoginAt: String? = null,
)

@Serializable
data class RoleDto(
    val id: String,
    val name: String,
    val description: String? = null,
    val isSystem: Boolean = false,
    /** في قراءة تفاصيل الدور — `GET /roles/{id}`. */
    val permissionCodes: List<String> = emptyList(),
)

@Serializable
data class MembershipScopeDto(
    val roleId: String,
    val scopeType: String,
    val scopeId: String,
)

@Serializable
data class MembershipDto(
    val id: String,
    val tenantId: String,
    val tenantCode: String,
    val tenantName: String,
    val displayName: String,
    val status: String = "active",
    val isOwner: Boolean = false,
    val branchScope: List<String>? = null,
    val roles: List<RoleDto> = emptyList(),
    val kind: String = "staff",
    val scopes: List<MembershipScopeDto> = emptyList(),
    val maxDiscountPct: String? = null,
    val maxDiscountAmount: String? = null,
)

@Serializable
data class ImpersonationDto(
    val sessionId: String,
    val operatorUserId: String,
    val operatorLabel: String? = null,
    val reason: String,
    val startedAt: String,
    val expiresAt: String,
)

@Serializable
data class LoginResponse(
    val accessToken: String,
    val refreshToken: String,
    val tokenType: String = "Bearer",
    val expiresIn: Int = 900,
    val user: UserDto,
    val memberships: List<MembershipDto> = emptyList(),
)

@Serializable
data class MeResponse(
    val user: UserDto,
    val membership: MembershipDto,
    val permissions: List<String> = emptyList(),
    val platformPermissions: List<String> = emptyList(),
    val impersonation: ImpersonationDto? = null,
    val branchScope: List<String>? = null,
    val enabledApps: List<String> = emptyList(),
) {
    fun can(permission: String): Boolean = permissions.any { it == permission || it == "*" }
}
