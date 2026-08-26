import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import {
  GiteaTeamResponseDto,
  GiteaTeamSearchQueryDto,
} from 'src/dto/giteaTeam.dto';
import { Scopes } from 'src/shared/decorators/scopes.decorator';
import { Scope } from 'src/shared/enums/scopes.enum';
import { UserRole } from 'src/shared/enums/userRole.enum';
import { Roles } from 'src/shared/guards/tokenRoles.guard';
import { GiteaService } from 'src/shared/modules/global/gitea.service';

@ApiTags('Gitea Teams')
@ApiBearerAuth()
@Controller('/gitea/teams')
export class GiteaTeamController {
  constructor(private readonly giteaService: GiteaService) {}

  @Get()
  @Roles(UserRole.Admin, UserRole.Copilot, UserRole.ProjectManager)
  @Scopes(Scope.ReadGiteaTeam)
  @ApiOperation({
    summary: 'Search Gitea teams by name',
    description:
      'Roles: Admin, Copilot, Project Manager | Scopes: read:gitea-team. ' +
      'Searches every Gitea organization, so each match is returned with the ' +
      'organization owning it; team names are only unique within an organization.',
  })
  @ApiResponse({
    status: 200,
    description: 'Matching Gitea teams, exact name matches first.',
    type: [GiteaTeamResponseDto],
  })
  async searchTeams(
    @Query() query: GiteaTeamSearchQueryDto,
  ): Promise<GiteaTeamResponseDto[]> {
    return this.giteaService.searchTeams(query.q, query.limit ?? 20);
  }
}
