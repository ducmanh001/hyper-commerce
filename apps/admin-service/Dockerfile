ARG SERVICE=admin-service
FROM 123456789.dkr.ecr.ap-southeast-1.amazonaws.com/hypercommerce/base:latest AS production
ARG SERVICE
ENV SERVICE=${SERVICE}
CMD node dist/apps/admin-service/main
