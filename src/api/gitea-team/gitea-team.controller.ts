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
} from '../../dto/giteaTeam.dto';
import { Scopes } from '../../shared/decorators/scopes.decorator';
import { User } from '../../shared/decorators/user.decorator';
import { Scope } from '../../shared/enums/scopes.enum';
import { UserRole } from '../../shared/enums/userRole.enum';
import { Roles } from '../../shared/guards/tokenRoles.guard';
import { GiteaTeamSearchService } from '../../shared/modules/global/gitea-team-search.service';
import { JwtUser } from '../../shared/modules/global/jwt.service';

@ApiTags('Gitea Teams')
@ApiBearerAuth()
@Controller('/reviews/gitea/teams')
export class GiteaTeamController {
  constructor(
    private readonly giteaTeamSearchService: GiteaTeamSearchService,
  ) {}

  @Get()
  @Roles(UserRole.Admin, UserRole.Copilot, UserRole.ProjectManager)
  @Scopes(Scope.ReadGiteaTeam)
  @ApiOperation({
    summary: 'Search Gitea teams by name',
    description:
      'Roles: Admin, Copilot, Project Manager | Scopes: read:gitea-team. ' +
      'Searches the Gitea organizations the signed-in user belongs to, public and private ' +
      'alike, so each match is returned with the organization owning it; team names are ' +
      'only unique within an organization. Returns nothing when the caller has no Gitea ' +
      'account.',
  })
  @ApiResponse({
    status: 200,
    description: 'Matching Gitea teams, exact name matches first.',
    type: [GiteaTeamResponseDto],
  })
  async searchTeams(
    @Query() query: GiteaTeamSearchQueryDto,
    @User() authUser: JwtUser,
  ): Promise<GiteaTeamResponseDto[]> {
    return this.giteaTeamSearchService.searchTeams(
      authUser,
      query.q,
      query.limit ?? 20,
    );
  }
}
