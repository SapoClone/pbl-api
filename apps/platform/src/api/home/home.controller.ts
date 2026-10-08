import { ApiPublic } from '@/decorators/http.decorators';
import { Controller, Get } from '@nestjs/common';
import { Public } from '@pbl/auth';

@Controller('/')
export class HomeController {
  @Get()
  @Public()
  @ApiPublic({ summary: 'Home' })
  home() {
    return 'Welcome to the API';
  }
}
