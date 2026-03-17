import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  // Seed admin user
  const existingAdmin = await prisma.user.findUnique({
    where: { email: 'admin@brainup.com' },
  });

  if (!existingAdmin) {
    const passwordHash = await bcrypt.hash('Admin@123', 10);
    await prisma.user.create({
      data: {
        name: 'Admin',
        email: 'admin@brainup.com',
        passwordHash,
        role: 'Admin',
        isActive: true,
      },
    });
    console.log('Admin user created: admin@brainup.com / Admin@123');
  } else {
    console.log('Admin user already exists, skipping.');
  }

  // Seed plans
  const plans = [
    {
      name: 'Solo Videos',
      slug: 'videos-only',
      description: 'Accede a toda la biblioteca de videos educativos',
      price: 299.99,
      billingCycle: 'Monthly' as const,
      includesVideos: true,
      includesCourses: false,
      isActive: true,
      features: [
        'Acceso ilimitado a videos',
        'Todas las categorías',
        'Descarga para ver sin conexión',
        'Soporte por email',
      ],
      displayOrder: 1,
    },
    {
      name: 'Solo Cursos',
      slug: 'courses-only',
      description: 'Inscríbete en cursos en vivo con instructores expertos',
      price: 599.99,
      billingCycle: 'Monthly' as const,
      includesVideos: false,
      includesCourses: true,
      isActive: true,
      features: [
        'Cursos en vivo ilimitados',
        'Instructores certificados',
        'Certificados de completación',
        'Soporte prioritario',
      ],
      displayOrder: 2,
    },
    {
      name: 'Completo',
      slug: 'complete',
      description: 'Todo incluido: videos y cursos en vivo',
      price: 749.99,
      billingCycle: 'Monthly' as const,
      includesVideos: true,
      includesCourses: true,
      isActive: true,
      features: [
        'Acceso ilimitado a videos',
        'Cursos en vivo ilimitados',
        'Instructores certificados',
        'Certificados de completación',
        'Descarga para ver sin conexión',
        'Soporte prioritario 24/7',
      ],
      displayOrder: 3,
    },
  ];

  for (const plan of plans) {
    const existing = await prisma.plan.findUnique({ where: { slug: plan.slug } });
    if (!existing) {
      await prisma.plan.create({ data: plan });
      console.log(`Plan created: ${plan.name}`);
    } else {
      console.log(`Plan already exists: ${plan.name}, skipping.`);
    }
  }

  console.log('Seed completed successfully.');
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
