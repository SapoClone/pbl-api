import { AccountEntity } from '@/api/account/entities/account.entity';
import { SYSTEM_USER_ID } from '@/constants/app.constant';
import { DataSource } from 'typeorm';
import { Seeder, SeederFactoryManager } from 'typeorm-extension';

export class AccountSeeder1722335726360 implements Seeder {
  track = false;

  public async run(
    dataSource: DataSource,
    factoryManager: SeederFactoryManager,
  ): Promise<void> {
    const repository = dataSource.getRepository(AccountEntity);
    if (!(await repository.findOneBy({ email: 'admin@example.com' }))) {
      await repository.save(
        new AccountEntity({
          email: 'admin@example.com',
          password: '12345678',
          name: 'Admin',
          createdBy: SYSTEM_USER_ID,
          updatedBy: SYSTEM_USER_ID,
        }),
      );
    }
    await factoryManager.get(AccountEntity).saveMany(5);
  }
}
