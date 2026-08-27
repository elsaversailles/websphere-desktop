import { SetMetadata } from '@nestjs/common';
import type { Role } from '@websphere/shared';

export const IS_PUBLIC_KEY = 'websphere:is-public';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const ROLES_KEY = 'websphere:roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export const GROUP_SCOPE_KEY = 'websphere:group-scope';
export const GroupScope = (parameter = 'id') => SetMetadata(GROUP_SCOPE_KEY, parameter);

export const PROJECT_SCOPE_KEY = 'websphere:project-scope';
export const ProjectScope = (parameter = 'id') => SetMetadata(PROJECT_SCOPE_KEY, parameter);
